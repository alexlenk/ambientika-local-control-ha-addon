/**
 * Humidity threshold levels (byte 10 of the 21-byte status packet).
 * Used by AUTO and SURVEILLANCE modes to trigger humidity-alarm ventilation.
 *
 * Source: Ambientika Smart APP manual (P06506000, EN October 2023)
 * "the MASTER unit detects ambient humidity above the threshold set from
 *  the 3 available (40 %, 60 %, 75 %)"
 */
export enum HumidityLevel {
    /** Trigger ventilation above 40 % relative humidity. */
    DRY = 0,

    /** Trigger ventilation above 60 % relative humidity. */
    NORMAL = 1,

    /** Trigger ventilation above 75 % relative humidity. */
    MOIST = 2
}
