#!/usr/bin/env python3
"""
play-device.py — Simulate one or more Ambientika devices connecting to the cloud.

For each device serial specified:
  1. Connects to cloud:11000 (outbound, simulating the device)
  2. Sends firmware info packet (0x03, 18 bytes)
  3. Sends status packet (0x01, 21 bytes)
  4. Keeps the connection open and logs all data received from the cloud on that socket

Additionally listens on port 11000 for the cloud's inbound back-channel connection
(the cloud opens a separate TCP connection back to send commands/echoes).

Usage:
    TOKEN=<bearer> python3 play-device.py

Devices are hardcoded from the 2026-04-09 production log.
"""

import socket
import threading
import time
import logging
import sys
import os

CLOUD_HOST = "185.214.203.87"
CLOUD_PORT = 11000
LISTEN_PORT = 11000

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s.%(msecs)03d %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("play-device.log", mode="w"),
    ],
)
log = logging.getLogger("play-device")

# ---------------------------------------------------------------------------
# Packet parser (same as debug-proxy.py)
# ---------------------------------------------------------------------------
OPERATING_MODES = {0:"SMART",1:"AUTO",2:"MANUAL_HEAT_RECOVERY",3:"NIGHT",4:"AWAY_HOME",
                   5:"SURVEILLANCE",6:"TIMED_EXPULSION",7:"EXPULSION",8:"INTAKE",
                   9:"MASTER_SLAVE_FLOW",10:"SLAVE_MASTER_FLOW",11:"OFF"}
FAN_SPEEDS   = {0:"LOW",1:"MEDIUM",2:"HIGH",3:"NIGHT"}
DEVICE_ROLES = {0:"MASTER",1:"SLAVE_EQUAL",2:"SLAVE_OPPOSITE"}
AIR_QUALITY  = {0:"VERY_GOOD",1:"GOOD",2:"MEDIUM",3:"POOR",4:"BAD"}
FILTER_STATUS= {0:"GOOD",1:"MEDIUM",2:"BAD"}

def parse_packet(data: bytes) -> str:
    n = len(data)
    h = data.hex()
    if n == 18 and data[0] == 0x03:
        return (f"[0x03 FIRMWARE 18b] serial={data[2:8].hex()} "
                f"radioFW={data[8]}.{data[9]}.{data[10]} "
                f"microFW={data[11]}.{data[12]}.{data[13]}")
    if n == 21 and data[0] == 0x01:
        return (f"[0x01 STATUS 21b] serial={data[2:8].hex()} "
                f"mode={OPERATING_MODES.get(data[8], data[8])} "
                f"speed={FAN_SPEEDS.get(data[9], data[9])} "
                f"role={DEVICE_ROLES.get(data[17], data[17])} "
                f"temp={data[11]}°C hum={data[12]}% "
                f"aq={AIR_QUALITY.get(data[13]-1, data[13])} "
                f"filter={FILTER_STATUS.get(data[15], data[15])}")
    if n == 16 and data[0] == 0x02 and data[8] == 0x00:
        role = DEVICE_ROLES.get(data[9], data[9])
        hid  = int.from_bytes(data[12:16], "little")
        return f"[0x02 SETUP 16b] serial={data[2:8].hex()} role={role} zone={data[10]} houseId={hid}"
    if n == 13 and data[0] == 0x02:
        sub = data[8]
        if sub == 0x01:
            return (f"[0x02/01 MODE-CMD 13b] serial={data[2:8].hex()} "
                    f"mode={OPERATING_MODES.get(data[9], data[9])} "
                    f"speed={FAN_SPEEDS.get(data[10], data[10])}")
        if sub == 0x04:
            temp = int.from_bytes(data[9:11], "little") / 100
            return (f"[0x02/04 WEATHER 13b] serial={data[2:8].hex()} "
                    f"temp={temp}°C hum={data[11]}%")
        return f"[0x02/{sub:02x} CMD 13b] serial={data[2:8].hex()} hex={h}"
    if n == 9 and data[0] == 0x02 and data[8] == 0x03:
        return f"[0x02/03 FILTER-RESET 9b] serial={data[2:8].hex()}"
    if n == 8 and data[0] == 0x04:
        return f"[0x04 KEEPALIVE 8b] serial={data[2:8].hex()}"
    return f"[UNKNOWN {n}b] hex={h}"

# ---------------------------------------------------------------------------
# Device definitions (from 2026-04-09 log)
#
# firmware:  03 00 <MAC> <radioFW 3b> <microFW 3b> <radioAT 4b>
# status:    01 00 <MAC> <mode> <speed> <humLvl> <temp> <hum%> <aq> <humAlarm>
#                        <filter> <nightAlarm> <role> <lastMode> <light> <wifi>
# ---------------------------------------------------------------------------
DEVICES = [
    {
        "name": "8813BF1650E0 Wohnzimmer (MASTER zone0 h12048)",
        "serial": bytes.fromhex("8813bf1650e0"),
        "firmware": bytes.fromhex("03008813bf1650e0010109010109020100 00".replace(" ", "")),
        "status":   bytes.fromhex("01008813bf1650e000020114 1e03000000000002ce".replace(" ", "")),
    },
    {
        "name": "8813BF164098 Kinderzimmer (SLAVE_OPP zone0 h12048)",
        "serial": bytes.fromhex("8813bf164098"),
        "firmware": bytes.fromhex("03008813bf164098010109010109020100 00".replace(" ", "")),
        "status":   bytes.fromhex("01008813bf164098080101151f03000000020102cc"),
    },
]

# ---------------------------------------------------------------------------
# Cloud inbound listener (cloud → us)
# ---------------------------------------------------------------------------
inbound_packets = []

def run_inbound_listener():
    """Listen on port 11000 for the cloud's back-channel connection."""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind(("0.0.0.0", LISTEN_PORT))
    except OSError as e:
        log.error(f"Cannot bind port {LISTEN_PORT}: {e}")
        log.error("Make sure port 11000 is free (add-on stopped).")
        return
    server.listen(10)
    log.info(f"Inbound listener ready on port {LISTEN_PORT} (waiting for cloud back-channel)")
    server.settimeout(150)
    try:
        while True:
            try:
                conn, addr = server.accept()
            except socket.timeout:
                log.info("Inbound listener: no connection in 2 minutes, giving up.")
                break
            log.info(f"INBOUND connection from {addr[0]}:{addr[1]}")
            threading.Thread(target=handle_inbound, args=(conn, addr), daemon=True).start()
    finally:
        server.close()

def handle_inbound(conn: socket.socket, addr):
    try:
        while True:
            data = conn.recv(4096)
            if not data:
                log.info(f"Inbound from {addr[0]} closed")
                break
            parsed = parse_packet(data)
            log.info(f"INBOUND {addr[0]}  ← cloud  {len(data)}b  {parsed}")
            log.debug(f"INBOUND hex: {data.hex()}")
            inbound_packets.append((time.time(), addr, data))
    except Exception as e:
        log.warning(f"Inbound handler error: {e}")
    finally:
        conn.close()

# ---------------------------------------------------------------------------
# Outbound device simulation
# ---------------------------------------------------------------------------
def play_device(device: dict):
    name   = device["name"]
    fw_pkt = device["firmware"]
    st_pkt = device["status"]

    log.info(f"[{name}] Connecting to {CLOUD_HOST}:{CLOUD_PORT}")
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.connect((CLOUD_HOST, CLOUD_PORT))
    except Exception as e:
        log.error(f"[{name}] Connection failed: {e}")
        return

    log.info(f"[{name}] Connected")

    # Start reader thread for data the cloud sends back on this same socket
    def reader():
        try:
            while True:
                data = sock.recv(4096)
                if not data:
                    log.info(f"[{name}] Cloud closed outbound socket")
                    break
                parsed = parse_packet(data)
                log.info(f"[{name}] ← cloud(outbound)  {len(data)}b  {parsed}")
                log.debug(f"[{name}] outbound rx hex: {data.hex()}")
                # Respond to keepalive (0x04) with a status packet — mirrors real device behaviour
                if len(data) == 8 and data[0] == 0x04:
                    log.info(f"[{name}] → cloud  KEEPALIVE RESPONSE  {parse_packet(st_pkt)}")
                    sock.sendall(st_pkt)
        except Exception as e:
            log.warning(f"[{name}] Reader error: {e}")

    threading.Thread(target=reader, daemon=True).start()

    # Send firmware info
    log.info(f"[{name}] → cloud  {parse_packet(fw_pkt)}")
    sock.sendall(fw_pkt)
    time.sleep(0.5)

    # Send status every 30s for 120s (matches real device behavior)
    run_seconds = 120
    interval = 30
    elapsed = 0
    while elapsed < run_seconds:
        log.info(f"[{name}] → cloud  {parse_packet(st_pkt)}")
        sock.sendall(st_pkt)
        time.sleep(interval)
        elapsed += interval

    sock.close()
    log.info(f"[{name}] Done")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    log.info("=== play-device.py starting ===")
    log.info(f"Simulating {len(DEVICES)} device(s) to {CLOUD_HOST}:{CLOUD_PORT}")

    # Start inbound listener first (so it's ready before cloud tries to connect back)
    t_inbound = threading.Thread(target=run_inbound_listener, daemon=True)
    t_inbound.start()
    time.sleep(0.3)  # give listener time to bind

    # Simulate devices (one thread per device)
    threads = []
    for device in DEVICES[:1]:  # single MASTER device for keepalive test
        t = threading.Thread(target=play_device, args=(device,), daemon=False)
        t.start()
        threads.append(t)
        time.sleep(0.5)  # stagger connections slightly

    for t in threads:
        t.join()

    log.info(f"=== Done. Inbound packets received: {len(inbound_packets)} ===")
    if inbound_packets:
        log.info("Summary of inbound (cloud back-channel) packets:")
        for ts, addr, data in inbound_packets:
            log.info(f"  {addr[0]}  {parse_packet(data)}")

if __name__ == "__main__":
    main()
