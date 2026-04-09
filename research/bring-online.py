#!/usr/bin/env python3
"""
Test script for cloud online-status requirements.
Usage: python3 bring-online.py [mode] [delay]
  mode  = 'normal'  (default) — one persistent connection per device
          'split'             — firmware on one connection, each status on a new connection
  delay = seconds to wait after TCP connect before sending firmware (default 0, normal mode only)

Examples:
  python3 bring-online.py                 → normal, persistent connections
  python3 bring-online.py normal 3        → normal, 3s delay before firmware
  python3 bring-online.py split           → split connections (tests cross-connection tracking)
"""
import socket, time, threading, sys

CLOUD = ("185.214.203.87", 11000)

args = sys.argv[1:]
MODE = args[0] if args else 'normal'
DELAY = float(args[1]) if len(args) > 1 else 0
STATUS_DELAY = float(args[2]) if len(args) > 2 else 0.1

DEVICES = [
    {
        "name": "8813BF1650E0 (MASTER)",
        "firmware": bytes.fromhex("03008813bf1650e001010901010902010000"),
        "status":   bytes.fromhex("01008813bf1650e0000201151c03000000000002ce"),
    },
    {
        "name": "8813BF15FF74",
        "firmware": bytes.fromhex("03008813bf15ff7401010901010902010000"),
        "status":   bytes.fromhex("01008813bf15ff74000201152500000001000002ce"),
    },
    {
        "name": "8813BF16089C",
        "firmware": bytes.fromhex("03008813bf16089c01010901010902010000"),
        "status":   bytes.fromhex("01008813bf16089c000201181600000000000002ce"),
    },
    {
        "name": "8813BF164098",
        "firmware": bytes.fromhex("03008813bf16409801010901010902010000"),
        "status":   bytes.fromhex("01008813bf164098080101151f03000000020102cc"),
    },
    {
        "name": "8813BF164AA8",
        "firmware": bytes.fromhex("03008813bf164aa801010901010902010000"),
        "status":   bytes.fromhex("01008813bf164aa8090101152503000000020102ce"),
    },
    {
        "name": "4831B7ADF390",
        "firmware": bytes.fromhex("03004831b7adf39001010c01010c02040200"),
        "status":   bytes.fromhex("01004831b7adf390000301152400000200020102c7"),
    },
]

def send_one(data, label):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect(CLOUD)
    s.sendall(data)
    print(f"  → sent {label} ({len(data)} bytes), closing")
    s.close()

def run_device_normal(d):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect(CLOUD)
    if DELAY > 0:
        print(f"{d['name']} → connected, waiting {DELAY}s before firmware...")
        time.sleep(DELAY)
    s.sendall(d["firmware"])
    print(f"{d['name']} → firmware sent, waiting {STATUS_DELAY}s before first status...")
    time.sleep(STATUS_DELAY)
    s.sendall(d["status"])
    print(f"{d['name']} → status sent")
    while True:
        time.sleep(30)
        s.sendall(d["status"])
        print(f"{d['name']} → status sent (periodic)")

def run_device_split(d):
    # Send firmware + first status on the same connection, then close it.
    # Each subsequent status goes on its own fresh connection.
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect(CLOUD)
    s.sendall(d["firmware"])
    print(f"{d['name']} → firmware sent")
    time.sleep(0.1)
    s.sendall(d["status"])
    print(f"{d['name']} → status sent, waiting 5s then closing initial connection")
    time.sleep(5)
    s.close()
    print(f"{d['name']} → initial connection closed")
    while True:
        time.sleep(30)
        send_one(d["status"], "status (periodic)")
        print(f"{d['name']} → status sent (periodic)")

print(f"Starting in mode={MODE}" + (f", connect-to-firmware delay={DELAY}s" if MODE == 'normal' and DELAY else "") + (f", firmware-to-status delay={STATUS_DELAY}s" if MODE == 'normal' else "") + ". Ctrl+C to stop.")

run_fn = run_device_split if MODE == 'split' else run_device_normal

for d in DEVICES:
    threading.Thread(target=run_fn, args=(d,), daemon=True).start()
    time.sleep(0.2)

try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("Stopped.")
