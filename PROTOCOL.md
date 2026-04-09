# Ambientika Binary Protocol Reference

Reverse-engineered from device traffic and cross-referenced against the official
Ambientika Smart APP manual (P06506000, EN October 2023) and sragas/ambientika-local-control.

> **Correction vs. sragas docs:** The device setup packet (16 bytes) has `role` at byte 9
> and `zone` at byte 10. The sragas protocol doc has these **swapped**. The layout below is
> correct as confirmed by cloud traffic and add-on testing.

---

## Overview

Devices connect to `app.ambientika.eu:11000` (or the proxy) via a persistent raw TCP socket.
There is no framing or length prefix — messages are distinguished entirely by byte length.

### Packet types (by length)

| Length | Direction         | Type                   |
|--------|-------------------|------------------------|
| 18     | Device → Cloud    | Firmware info          |
| 21     | Device → Cloud    | Device status          |
| 15     | Cloud → Device    | Device setup (cloud-initiated) |
| 16     | Cloud → Device    | Device setup (proxy-injected)  |
| 13     | Cloud → Device    | Operating mode command |
| 14     | Cloud → Device    | Operating mode command (with schedule byte) |
| 13     | Cloud → Device    | Weather update         |
| 9      | Cloud → Device    | Filter reset           |
| 8      | Cloud → Device    | Keepalive / ping       |
| 7      | UDP broadcast     | Master→Slave zone sync |

---

## Firmware info message (18 bytes)

Sent once by the device immediately after connecting.

```
03 00 <MAC 6 bytes> <radio FW 3 bytes> <micro FW 3 bytes> <radio AT FW 4 bytes>
```

Example: `03 00 ab cd ef ab cd ef 00 00 1c 00 01 16 02 01 00 00`

| Offset | Length | Description                     |
|--------|--------|---------------------------------|
| 0      | 1      | Fixed `0x03`                    |
| 1      | 1      | Fixed `0x00`                    |
| 2–7    | 6      | Device MAC address (serial)     |
| 8      | 1      | Radio FW version part 1         |
| 9      | 1      | Radio FW version part 2         |
| 10     | 1      | Radio FW version part 3         |
| 11     | 1      | Micro FW version part 1         |
| 12     | 1      | Micro FW version part 2         |
| 13     | 1      | Micro FW version part 3         |
| 14     | 1      | Radio AT command FW part 1      |
| 15     | 1      | Radio AT command FW part 2      |
| 16     | 1      | Radio AT command FW part 3      |
| 17     | 1      | Radio AT command FW part 4      |

---

## Device status message (21 bytes)

Sent every ~30 seconds by the device.

```
01 00 <MAC 6 bytes> <mode> <speed> <humidity> <temp> <humid%> <airQ> <humAlarm> <filter> <nightAlarm> <role> <lastMode> <light> <wifi>
```

Example: `01 00 ab cd ef ab cd ef 01 02 01 14 37 02 01 00 00 00 01 03 c3`

| Offset | Length | Field               | Type   | Notes                              |
|--------|--------|---------------------|--------|------------------------------------|
| 0      | 1      | Fixed `0x01`        | uint8  |                                    |
| 1      | 1      | Fixed `0x00`        | uint8  |                                    |
| 2–7    | 6      | MAC / serial        | hex    |                                    |
| 8      | 1      | Operating mode      | uint8  | See OperatingMode enum             |
| 9      | 1      | Fan speed           | uint8  | See FanSpeed enum                  |
| 10     | 1      | Humidity level      | uint8  | See HumidityLevel enum             |
| 11     | 1      | Temperature         | uint8  | Degrees Celsius                    |
| 12     | 1      | Humidity            | uint8  | Percent                            |
| 13     | 1      | Air quality         | uint8  | Raw value is 1-based; subtract 1   |
| 14     | 1      | Humidity alarm      | uint8  | 0=OFF, 1=ON                        |
| 15     | 1      | Filter status       | uint8  | See FilterStatus enum              |
| 16     | 1      | Night alarm         | uint8  | 0=OFF, 1=ON                        |
| 17     | 1      | Device role         | uint8  | See DeviceRole enum                |
| 18     | 1      | Last operating mode | uint8  | See OperatingMode enum             |
| 19     | 1      | Light sensitivity   | uint8  | See LightSensitivity enum          |
| 20     | 1      | WiFi signal (mW)    | uint8  |                                    |

---

## Device setup packet (15 or 16 bytes)

Sent by the cloud to configure a device's role, zone, and house assignment.

**Two variants exist:**

### Cloud-initiated setup (15 bytes)

Sent by the cloud in response to `GET /Device/send-device-config` or `POST /Device/apply-config`.
Arrives on the device's outbound TCP connection (the same socket the device opened to the cloud).

```
02 00 <MAC 6 bytes> 00 <role> <zone> <houseId 4 bytes LE>
```

Example: `02 00 88 13 bf 16 50 e0 00 00 00 10 2f 00 00`
→ MAC=8813BF1650E0, role=MASTER(0), zone=0, houseId=12048 (0x00002F10 LE)

| Offset | Length | Field        | Type     | Notes                              |
|--------|--------|--------------|----------|------------------------------------|
| 0      | 1      | Fixed `0x02` | uint8    |                                    |
| 1      | 1      | Fixed `0x00` | uint8    |                                    |
| 2–7    | 6      | MAC / serial | hex      |                                    |
| 8      | 1      | Fixed `0x00` | uint8    | Padding                            |
| 9      | 1      | Device role  | uint8    | 0=MASTER, 1=SLAVE_EQUAL, 2=SLAVE_OPPOSITE |
| 10     | 1      | Zone index   | uint8    | 0-based; port = 45000 + zone       |
| 11–14  | 4      | House ID     | uint32LE | Little-endian; **no padding byte** |

### Proxy-injected setup (16 bytes)

Sent by the add-on's `/cloud/send-setup` REST endpoint directly to the device socket.
Also the format used when forwarding cloud setup packets via the inbound back-channel.

```
02 00 <MAC 6 bytes> 00 <role> <zone> 00 <houseId 4 bytes LE>
```

| Offset | Length | Field        | Type     | Notes                              |
|--------|--------|--------------|----------|------------------------------------|
| 0      | 1      | Fixed `0x02` | uint8    |                                    |
| 1      | 1      | Fixed `0x00` | uint8    |                                    |
| 2–7    | 6      | MAC / serial | hex      |                                    |
| 8      | 1      | Fixed `0x00` | uint8    | Padding                            |
| 9      | 1      | Device role  | uint8    | 0=MASTER, 1=SLAVE_EQUAL, 2=SLAVE_OPPOSITE |
| 10     | 1      | Zone index   | uint8    | 0-based; port = 45000 + zone       |
| 11     | 1      | Fixed `0x00` | uint8    | Padding                            |
| 12–15  | 4      | House ID     | uint32LE | Little-endian                      |

> **sragas doc error:** The sragas protocol doc shows role at offset 10 and zone at offset 11.
> The correct layout (confirmed by cloud traffic) is role=9, zone=10.
>
> **v1.1.10 bug (fixed in v1.1.11):** The proxy checked `data.length === 16` for setup packets
> from the cloud, silently dropping all 15-byte cloud-initiated setup packets. Fixed to accept both
> 15 and 16 bytes, with houseId read from offset 11 (15-byte) or 12 (16-byte) accordingly.

---

## Operating mode command (13 or 14 bytes)

Sent by the cloud (or add-on) to change a device's operating mode.

The add-on sends 13 bytes. The cloud sends 14 bytes when the command originates from
`POST /Device/change-mode` — the extra byte encodes the schedule state.

```
02 00 <MAC 6 bytes> 01 <mode> <speed> <humidity> <light> [scheduleState]
```

| Offset | Length | Field             | Type  | Notes                                    |
|--------|--------|-------------------|-------|------------------------------------------|
| 0      | 1      | Fixed `0x02`      | uint8 |                                          |
| 1      | 1      | Fixed `0x00`      | uint8 |                                          |
| 2–7    | 6      | MAC / serial      | hex   |                                          |
| 8      | 1      | Fixed `0x01`      | uint8 | Command subtype                          |
| 9      | 1      | Operating mode    | uint8 | See OperatingMode enum                   |
| 10     | 1      | Fan speed         | uint8 | See FanSpeed enum                        |
| 11     | 1      | Humidity level    | uint8 | See HumidityLevel enum                   |
| 12     | 1      | Light sensitivity | uint8 | See LightSensitivity enum                |
| 13     | 1      | Schedule state    | uint8 | 14-byte variant only; 0=N/A, 1=Off, 2=On |

---

## Weather update command (13 bytes)

Sent by the cloud to push outdoor weather data to devices in SMART mode.

```
02 00 <MAC 6 bytes> 04 <temp lo> <temp hi> <humidity> <airQuality>
```

| Offset | Length | Field             | Type    | Notes                              |
|--------|--------|-------------------|---------|------------------------------------|
| 0      | 1      | Fixed `0x02`      | uint8   |                                    |
| 1      | 1      | Fixed `0x00`      | uint8   |                                    |
| 2–7    | 6      | MAC / serial      | hex     |                                    |
| 8      | 1      | Fixed `0x04`      | uint8   | Command subtype                    |
| 9–10   | 2      | Temperature       | uint16LE| Divide by 100 for °C               |
| 11     | 1      | Humidity          | uint8   | Percent                            |
| 12     | 1      | Air quality       | uint8   | See AirQuality enum                |

---

## Filter reset command (9 bytes)

```
02 00 <MAC 6 bytes> 03
```

| Offset | Length | Field        | Type  |
|--------|--------|--------------|-------|
| 0      | 1      | Fixed `0x02` | uint8 |
| 1      | 1      | Fixed `0x00` | uint8 |
| 2–7    | 6      | MAC / serial | hex   |
| 8      | 1      | Fixed `0x03` | uint8 |

---

## Cloud keepalive / ping (8 bytes)

Sent by the cloud on the inbound (cloud→proxy) connection. Only observed for MASTER-role devices. Timing from production logs: first keepalive ~60s after device connects, then every ~35–36s.

```
04 00 <MAC 6 bytes>
```

Example: `04 00 88 13 bf 16 50 e0`

| Offset | Length | Field        | Type  | Notes                        |
|--------|--------|--------------|-------|------------------------------|
| 0      | 1      | Fixed `0x04` | uint8 |                              |
| 1      | 1      | Fixed `0x00` | uint8 |                              |
| 2–7    | 6      | MAC / serial | hex   | Target device serial number  |

> **Interpretation:** This packet appears to be a cloud-side keepalive or ping directed at master devices. The add-on logs it as an unknown packet type and forwards it to the device socket unchanged (pass-through). No device response has been observed. Only seen on cloud inbound connections; never sent by devices.

---

## UDP Master→Slave broadcast (7 bytes)

Masters broadcast zone sync packets on UDP.
- Source port: `46000 + zoneIndex`
- Destination port: `45000 + zoneIndex`

```
65 <zone+fanMode nibbles> <speed+direction nibbles> <houseId 4 bytes BE>
```

Example: `65 30 28 00 00 12 ab`

| Offset | Bits   | Field               | Notes                                     |
|--------|--------|---------------------|-------------------------------------------|
| 0      | [7:0]  | Fixed `0x65`        |                                           |
| 1      | [7:4]  | Fixed `0x3`         |                                           |
| 1      | [3:0]  | Zone ID             | 0–15                                      |
| 2      | [7:4]  | Fan mode            | 0=OFF, 2=ALTERNATING, 3=PERMANENT         |
| 2      | [3:0]  | Speed + direction   | See table below                           |
| 3–6    | [31:0] | House ID            | uint32 big-endian                         |

**Speed + direction values**

| Value | Meaning           |
|-------|-------------------|
| 0     | STOP              |
| 1–2   | Startup speed     |
| 3     | OFF               |
| 4     | EXPULSION_NIGHT   |
| 5     | EXPULSION_LOW     |
| 6     | EXPULSION_MEDIUM  |
| 7     | EXPULSION_HIGH    |
| 8     | INTAKE_NIGHT      |
| 9     | INTAKE_LOW        |
| 10    | INTAKE_MEDIUM     |
| 11    | INTAKE_HIGH       |

---

## Enum reference

### OperatingMode (byte 8 of status)

| Value | Name                  |
|-------|-----------------------|
| 0     | SMART                 |
| 1     | AUTO                  |
| 2     | MANUAL_HEAT_RECOVERY  |
| 3     | NIGHT                 |
| 4     | AWAY_HOME             |
| 5     | SURVEILLANCE          |
| 6     | TIMED_EXPULSION       |
| 7     | EXPULSION             |
| 8     | INTAKE                |
| 9     | MASTER_SLAVE_FLOW     |
| 10    | SLAVE_MASTER_FLOW     |
| 11    | OFF                   |

### FanSpeed (byte 9 of status)

| Value | Name   | Notes                                    |
|-------|--------|------------------------------------------|
| 0     | LOW    |                                          |
| 1     | MEDIUM |                                          |
| 2     | HIGH   |                                          |
| 3     | NIGHT  | Quietest; set automatically at night     |

### DeviceRole (byte 17 of status, byte 9 of setup)

| Value | Name                    |
|-------|-------------------------|
| 0     | MASTER                  |
| 1     | SLAVE_EQUAL_MASTER      |
| 2     | SLAVE_OPPOSITE_MASTER   |

### HumidityLevel (byte 10 of status)

| Value | Name   | Threshold |
|-------|--------|-----------|
| 0     | DRY    | 40 %      |
| 1     | NORMAL | 60 %      |
| 2     | MOIST  | 75 %      |

### AirQuality (byte 13 of status, raw value is 1-based)

| Raw | Enum value | Name      |
|-----|------------|-----------|
| 1   | 0          | VERY_GOOD |
| 2   | 1          | GOOD      |
| 3   | 2          | MEDIUM    |
| 4   | 3          | POOR      |
| 5   | 4          | BAD       |

### FilterStatus (byte 15 of status)

| Value | Name   |
|-------|--------|
| 0     | GOOD   |
| 1     | MEDIUM |
| 2     | BAD    |

### LightSensitivity (byte 19 of status)

| Value | Name          |
|-------|---------------|
| 0     | NOT_AVAILABLE |
| 1     | OFF           |
| 2     | LOW           |
| 3     | MEDIUM        |

---

## Connection sequence

```
Device boots
  │
  ├─ TCP connect → cloud:11000 (or proxy:11000)
  ├─ Send 18-byte firmware info
  ├─ Receive 16-byte setup packet (role/zone/houseId assignment)
  └─ Loop every ~30s: Send 21-byte status

Cloud (after device connects)
  ├─ Opens a SECOND inbound TCP connection back to proxy:11000
  └─ Echoes device status/info packets back on this inbound connection
     (this is the cloud's acknowledgement mechanism — it does NOT use
      the outbound connection for replies)
```

> **Proxy note:** When running in proxy mode (cloud_sync_enabled=true), the add-on maintains
> one **outbound** TCP connection per device to the cloud, forwarding all device packets.
> The cloud opens **inbound** connections back to the proxy for each device it recognises.
> Cloud setup/command packets arrive on those inbound connections and must be routed to the
> correct device by serial number (bytes 2–7).

> **Cloud "online" requirement (confirmed 2026-04-09):** the cloud marks a device as online
> only after it receives **both** a firmware packet (0x03) **and** at least one status packet
> (0x01) on the same TCP connection. Firmware alone is not sufficient. The device stays online
> as long as status packets arrive every ~30s. Firmware must be re-sent when the TCP connection
> is re-established.
