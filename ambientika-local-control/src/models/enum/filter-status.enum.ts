/**
 * Filter condition reported by Ambientika devices (byte 15 of the 21-byte status packet).
 * When status is BAD, the device's red LED flashes every second and commands are
 * blocked until the filter is reset.
 */
export enum FilterStatus {
    GOOD,
    MEDIUM,
    BAD
}
