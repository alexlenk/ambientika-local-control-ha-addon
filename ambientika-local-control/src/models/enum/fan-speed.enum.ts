/**
 * Fan speed levels reported by Ambientika devices (byte 9 of the 21-byte status packet).
 *
 * Source: Ambientika Smart APP manual (P06506000, EN October 2023)
 *
 * The manual describes four distinct speeds:
 *   "minimum speed" (LOW), "average speed" (MEDIUM), "maximum speed" (HIGH),
 *   and "night-time speed" (NIGHT — quietest, used automatically at night).
 *
 * NIGHT speed is set automatically by SMART and NIGHT operating modes.
 * It is also used by MASTER_SLAVE_FLOW free-cooling at night.
 */
export enum FanSpeed {
    LOW = 0,
    MEDIUM = 1,
    HIGH = 2,
    /** Quieter than LOW. Set automatically at night by SMART / NIGHT modes. */
    NIGHT = 3
}
