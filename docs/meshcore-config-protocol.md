# MeshCore companion config protocol (firmware source of truth)

Validated against firmware **source** (not docs — docs disagree on scaling/magic):

- Repo: https://github.com/meshcore-dev/MeshCore commit `03b6ef4b0de98fc70b49ef10a6d0d61f8381fb7a`
- Handler: `examples/companion_radio/MyMesh.cpp` — dispatch chain `handleCmdFrame()` from line 1008
- Firmware: `FIRMWARE_VER_CODE = 13`, `FIRMWARE_VERSION = "v1.16.0"` (`MyMesh.h`)

## Conventions
- **All multi-byte ints are little-endian.** CMD byte is always `frame[0]`; payload follows (no inner length prefix — NUS framing is unchanged).
- **freq**: `u32 LE` in **kHz** = MHz × 1000 (869.525 MHz → `869525`). SELF_INFO 48..51; SET 1..4.
- **bw**: `u32 LE` in **Hz** = kHz × 1000 (250 kHz → `250000`). SELF_INFO 52..55; SET 5..8.
- **sf/cr**: `u8` (SF 5–12, CR 5–8). **tx_power**: `int8` dBm.
- Response helpers: OK=`[0]=0`; ERR=`[0]=1 [1]=err`; DISABLED=`[0]=15`. ERR codes: 1 UNSUPPORTED_CMD, 2 NOT_FOUND, 3 TABLE_FULL, 4 BAD_STATE, 5 FILE_IO, 6 ILLEGAL_ARG.

## Version-drift check — ALL existing constants match firmware (no drift)
CMD 1/2/3/4/7/8/10/22/31/32 and RESP 5/0/1/8/17/18/27, PUSH 0x83 — all confirmed.
`CMD_APP_START` requires `len>=8` (our 8-byte header is correct).

## Read current radio params — from SELF_INFO tail (NOT DEVICE_QUERY)
`RESP_CODE_SELF_INFO=5` response, extend our APP_START parser past offset 3:
`[2]=tx_power int8`, `[3]=max_tx_power u8`, `[48..51]=freq u32LE(kHz)`, `[52..55]=bw u32LE(Hz)`, `[56]=sf u8`, `[57]=cr u8`, `[58..]=node_name UTF-8` (to end, not NUL-terminated). Also `[36..39]=lat int32LE ×1e6`, `[40..43]=lon int32LE ×1e6`, `[45]=advert_loc_policy`.

## Config commands
| CMD | # | Request frame | Response |
|---|---|---|---|
| SET_RADIO_PARAMS | 11 | `[1..4]freq u32LE(kHz) [5..8]bw u32LE(Hz) [9]sf [10]cr [11]client_repeat?` | OK / ERR ILLEGAL_ARG. freq 150000–2500000, bw 7000–500000 |
| SET_RADIO_TX_POWER | 12 | `[1]power int8 dBm` | OK / ERR. −9..MAX_LORA_TX_POWER |
| SET_ADVERT_LATLON | 14 | `[1..4]lat int32LE ×1e6 [5..8]lon int32LE ×1e6 [9..12]alt?(ignored)` | OK / ERR |
| SET_TUNING_PARAMS | 21 | `[1..4]rx_delay_base u32LE ×1000 [5..8]airtime_factor u32LE ×1000` | OK |
| GET_TUNING_PARAMS | 43 | `[0]=43` | RESP 23: `[1..4]rx_delay ×1000 [5..8]airtime ×1000` |
| SET_OTHER_PARAMS | 38 | `[1]manual_add [2]telemetry_mode? [3]advert_loc_policy? [4]multi_acks?` | OK |
| SET_DEVICE_PIN | 37 | `[1..4]pin u32LE` (0=disable, else 100000–999999) | OK / ERR |
| GET_DEVICE_TIME | 5 | `[0]=5` | RESP_CODE_CURR_TIME=9: `[1..4]epoch u32LE` |
| SET_DEVICE_TIME | 6 | `[1..4]epoch u32LE` | OK (only if >= current RTC) |
| DEVICE_QUERY | 22 | `[1]app_target_ver` | RESP_CODE_DEVICE_INFO=13 (82B): `[1]fw_ver [2]max_contacts/2 [3]max_channels [4..7]ble_pin u32LE [8..19]build_date [20..59]mfr_name [60..79]fw_version [80]client_repeat [81]path_hash_mode` |
| GET_BATT_AND_STORAGE | 20 | `[0]=20` | RESP 12 (11B): `[1..2]mV u16LE [3..6]used_kb [7..10]total_kb` |
| SEND_SELF_ADVERT | 7 | `[1]flood_flag?` (1=flood scoped, 0/omitted=zero-hop) | OK / ERR TABLE_FULL |
| REBOOT | 19 | `[1..6]=ASCII "reboot"` (no NUL) | **NO reply** (device reboots) |
| FACTORY_RESET | 51 | `[1..5]=ASCII "reset"` | — |

## Not present in the companion protocol
- **No region/preset command** — map presets (EU868/US915) to explicit freq/bw/sf/cr client-side and send SET_RADIO_PARAMS.
- **No advert-interval command** — advert is triggered explicitly via SEND_SELF_ADVERT(7); interval is CLI/firmware-side only.
- EXPORT/IMPORT_PRIVATE_KEY (23/24) are compile-gated → RESP_CODE_DISABLED(15) if off.
