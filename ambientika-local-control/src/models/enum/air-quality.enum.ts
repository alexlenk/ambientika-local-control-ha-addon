/**
 * Air quality levels reported by Ambientika devices (byte 13 of the 21-byte status packet).
 * Determined by the CO2 / VOC sensor on the MASTER unit.
 *
 * Note: raw socket value is 1-based (subtract 1 before enum lookup — see device.mapper.ts).
 */
export enum AirQuality {
    VERY_GOOD,
    GOOD,
    MEDIUM,
    POOR,
    BAD
}
