#!/usr/bin/env python3
"""
debug-proxy.py — TCP debug proxy for Ambientika device ↔ cloud traffic.

Listens on port 11000 (or $PORT). For each device that connects:
  - Opens an outbound connection to the cloud (185.214.203.87:11000)
  - Relays all traffic bidirectionally
  - Logs every packet in hex with timestamp, direction, and parsed packet type

Also handles inbound connections FROM the cloud (185.214.203.87) — the cloud
opens a second TCP connection back to this proxy for commands/echoes.

Usage (run on the HA host after disabling the add-on):
    python3 debug-proxy.py

    # With custom port or cloud host:
    PORT=11000 CLOUD_HOST=185.214.203.87 CLOUD_PORT=11000 python3 debug-proxy.py

Output: all traffic logged to stdout + debug-proxy.log in the same directory.
"""

import socket
import threading
import time
import os
import sys
import logging

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = int(os.environ.get("PORT", "11000"))
CLOUD_HOST  = os.environ.get("CLOUD_HOST", "185.214.203.87")
CLOUD_PORT  = int(os.environ.get("CLOUD_PORT", "11000"))

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "debug-proxy.log")
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s.%(msecs)03d %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(log_path, mode="w"),
    ],
)
log = logging.getLogger("proxy")


# ---------------------------------------------------------------------------
# Packet parser
# ---------------------------------------------------------------------------
OPERATING_MODES = {0:"SMART",1:"AUTO",2:"MANUAL_HEAT_RECOVERY",3:"NIGHT",4:"AWAY_HOME",
                   5:"SURVEILLANCE",6:"TIMED_EXPULSION",7:"EXPULSION",8:"INTAKE",
                   9:"MASTER_SLAVE_FLOW",10:"SLAVE_MASTER_FLOW",11:"OFF"}
FAN_SPEEDS      = {0:"LOW",1:"MEDIUM",2:"HIGH",3:"NIGHT"}
DEVICE_ROLES    = {0:"MASTER",1:"SLAVE_EQUAL",2:"SLAVE_OPPOSITE"}
AIR_QUALITY     = {0:"VERY_GOOD",1:"GOOD",2:"MEDIUM",3:"POOR",4:"BAD"}
FILTER_STATUS   = {0:"GOOD",1:"MEDIUM",2:"BAD"}
CMD_SUBTYPES    = {0x00:"setup",0x01:"mode",0x03:"filter-reset",0x04:"weather"}


def mac(data: bytes, offset: int = 2) -> str:
    return data[offset:offset+6].hex()


def parse_packet(data: bytes) -> str:
    n = len(data)
    h = data.hex()
    if n == 18 and data[0] == 0x03:
        return (f"[0x03 FIRMWARE 18b] serial={mac(data)} "
                f"radioFW={data[8]}.{data[9]}.{data[10]} "
                f"microFW={data[11]}.{data[12]}.{data[13]} "
                f"radioAT={data[14]}.{data[15]}.{data[16]}.{data[17]}")
    if n == 21 and data[0] == 0x01:
        mode   = OPERATING_MODES.get(data[8], f"0x{data[8]:02x}")
        speed  = FAN_SPEEDS.get(data[9], f"0x{data[9]:02x}")
        role   = DEVICE_ROLES.get(data[17], f"0x{data[17]:02x}")
        aq     = AIR_QUALITY.get(data[13]-1, f"raw={data[13]}")
        filt   = FILTER_STATUS.get(data[15], f"0x{data[15]:02x}")
        return (f"[0x01 STATUS 21b] serial={mac(data)} "
                f"mode={mode} speed={speed} role={role} "
                f"temp={data[11]}°C hum={data[12]}% aq={aq} filter={filt} wifi={data[20]}")
    if n == 16 and data[0] == 0x02 and data[8] == 0x00:
        role  = DEVICE_ROLES.get(data[9], f"0x{data[9]:02x}")
        zone  = data[10]
        hid   = int.from_bytes(data[12:16], "little")
        return (f"[0x02 SETUP 16b] serial={mac(data)} "
                f"role={role} zone={zone} houseId={hid}")
    if n == 13 and data[0] == 0x02:
        sub = data[8]
        if sub == 0x01:
            mode  = OPERATING_MODES.get(data[9], f"0x{data[9]:02x}")
            speed = FAN_SPEEDS.get(data[10], f"0x{data[10]:02x}")
            return (f"[0x02/01 MODE-CMD 13b] serial={mac(data)} "
                    f"mode={mode} speed={speed}")
        if sub == 0x04:
            temp = int.from_bytes(data[9:11], "little") / 100
            return (f"[0x02/04 WEATHER 13b] serial={mac(data)} "
                    f"temp={temp}°C hum={data[11]}% aq={AIR_QUALITY.get(data[12], data[12])}")
        return f"[0x02/{sub:02x} CMD {n}b] serial={mac(data)} raw={h}"
    if n == 9 and data[0] == 0x02 and data[8] == 0x03:
        return f"[0x02/03 FILTER-RESET 9b] serial={mac(data)}"
    if n == 8 and data[0] == 0x04:
        return f"[0x04 KEEPALIVE 8b] serial={mac(data)}"
    return f"[UNKNOWN {n}b] raw={h}"


# ---------------------------------------------------------------------------
# Per-device relay
# ---------------------------------------------------------------------------
class DeviceRelay:
    """Manages the two-socket relay for one device connection."""

    def __init__(self, device_sock: socket.socket, device_addr: tuple):
        self.device_sock = device_sock
        self.device_addr = device_addr
        self.tag = f"{device_addr[0]}:{device_addr[1]}"
        self.cloud_sock: socket.socket | None = None

    def start(self):
        # Open outbound connection to cloud
        try:
            self.cloud_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.cloud_sock.connect((CLOUD_HOST, CLOUD_PORT))
            log.info(f"[{self.tag}] Connected to cloud {CLOUD_HOST}:{CLOUD_PORT}")
        except Exception as e:
            log.error(f"[{self.tag}] Failed to connect to cloud: {e}")
            self.device_sock.close()
            return

        # Start relay threads
        threading.Thread(target=self._relay, args=(self.device_sock, self.cloud_sock,
                                                    "dev→cloud"), daemon=True).start()
        threading.Thread(target=self._relay, args=(self.cloud_sock, self.device_sock,
                                                    "cloud→dev(outbound)"), daemon=True).start()

    def _relay(self, src: socket.socket, dst: socket.socket, direction: str):
        src_tag = self.tag
        try:
            while True:
                data = src.recv(4096)
                if not data:
                    log.info(f"[{src_tag}] {direction} connection closed")
                    break
                parsed = parse_packet(data)
                log.info(f"[{src_tag}] {direction} {len(data)}b  {parsed}")
                log.debug(f"[{src_tag}] {direction} hex: {data.hex()}")
                try:
                    dst.sendall(data)
                except Exception as e:
                    log.warning(f"[{src_tag}] {direction} send failed: {e}")
                    break
        except Exception as e:
            log.warning(f"[{src_tag}] {direction} relay error: {e}")
        finally:
            try: src.close()
            except: pass
            try: dst.close()
            except: pass


# ---------------------------------------------------------------------------
# Cloud inbound connection handler (cloud → proxy, separate socket)
# ---------------------------------------------------------------------------
# Key: serial number hex (lower), Value: device socket
device_registry: dict[str, socket.socket] = {}
device_registry_lock = threading.Lock()


def handle_cloud_inbound(cloud_sock: socket.socket, addr: tuple):
    """
    The cloud opens this connection to send commands/echoes to devices.
    Route each packet to the correct device socket based on serial in bytes 2–7.
    """
    log.info(f"[cloud-inbound] Cloud connected from {addr[0]}:{addr[1]}")
    try:
        while True:
            data = cloud_sock.recv(4096)
            if not data:
                log.info("[cloud-inbound] Cloud closed inbound connection")
                break
            parsed = parse_packet(data)
            log.info(f"[cloud-inbound] cloud→dev(inbound) {len(data)}b  {parsed}")
            log.debug(f"[cloud-inbound] hex: {data.hex()}")

            # Route to device by serial (bytes 2–7)
            if len(data) >= 8:
                serial = data[2:8].hex()
                with device_registry_lock:
                    dev_sock = device_registry.get(serial)
                if dev_sock:
                    try:
                        dev_sock.sendall(data)
                        log.debug(f"[cloud-inbound] Routed to device {serial}")
                    except Exception as e:
                        log.warning(f"[cloud-inbound] Failed to route to {serial}: {e}")
                else:
                    log.warning(f"[cloud-inbound] No device socket for serial {serial}")
    except Exception as e:
        log.warning(f"[cloud-inbound] Error: {e}")
    finally:
        cloud_sock.close()


# ---------------------------------------------------------------------------
# Main server
# ---------------------------------------------------------------------------
def handle_connection(conn: socket.socket, addr: tuple):
    """Dispatch an incoming connection: device or cloud inbound."""
    peer_ip = addr[0]

    if peer_ip == CLOUD_HOST:
        # Cloud is connecting back to send commands
        threading.Thread(target=handle_cloud_inbound, args=(conn, addr), daemon=True).start()
        return

    # Device connecting — start relay
    log.info(f"[{peer_ip}:{addr[1]}] Device connected")
    relay = DeviceRelay(conn, addr)

    # Wrap relay to register device serials as we see firmware/status packets
    original_relay_method = relay._relay

    def patched_relay(src, dst, direction, _relay=relay):
        try:
            while True:
                data = src.recv(4096)
                if not data:
                    log.info(f"[{_relay.tag}] {direction} connection closed")
                    break
                parsed = parse_packet(data)
                log.info(f"[{_relay.tag}] {direction} {len(data)}b  {parsed}")
                log.debug(f"[{_relay.tag}] {direction} hex: {data.hex()}")

                # Register device serial → socket for cloud inbound routing
                if direction == "dev→cloud" and len(data) in (18, 21) and data[0] in (0x01, 0x03):
                    serial = data[2:8].hex()
                    with device_registry_lock:
                        device_registry[serial] = _relay.device_sock
                    log.debug(f"[{_relay.tag}] Registered serial {serial}")

                try:
                    dst.sendall(data)
                except Exception as e:
                    log.warning(f"[{_relay.tag}] {direction} send failed: {e}")
                    break
        except Exception as e:
            log.warning(f"[{_relay.tag}] {direction} error: {e}")
        finally:
            try: src.close()
            except: pass
            try: dst.close()
            except: pass
            # Deregister all serials pointing to this device socket
            with device_registry_lock:
                stale = [k for k, v in device_registry.items() if v is _relay.device_sock]
                for k in stale:
                    del device_registry[k]
                    log.debug(f"Deregistered serial {k}")

    relay._relay = patched_relay
    relay.start()


def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((LISTEN_HOST, LISTEN_PORT))
    server.listen(50)
    log.info(f"Debug proxy listening on {LISTEN_HOST}:{LISTEN_PORT}")
    log.info(f"Relaying to cloud at {CLOUD_HOST}:{CLOUD_PORT}")
    log.info(f"Log file: {log_path}")

    try:
        while True:
            conn, addr = server.accept()
            threading.Thread(target=handle_connection, args=(conn, addr), daemon=True).start()
    except KeyboardInterrupt:
        log.info("Shutting down.")
    finally:
        server.close()


if __name__ == "__main__":
    main()
