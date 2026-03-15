/**
 * Detailed fan status reported in UDP broadcast packets (lower nibble of byte 2).
 * Combines direction (expulsion / intake) and speed, plus transitional states.
 */
export enum FanStatus {
    /** Fan is stopped. */
    STOP = 0,

    /** Fan is starting up (low ramp). */
    START_SLOW = 1,

    /** Fan is starting up (medium ramp). */
    START_MEDIUM = 2,

    /** Fan is off / idle. */
    OFF = 3,

    EXPULSION_NIGHT = 4,
    EXPULSION_LOW = 5,
    EXPULSION_MEDIUM = 6,
    EXPULSION_HIGH = 7,

    INTAKE_NIGHT = 8,
    INTAKE_LOW = 9,
    INTAKE_MEDIUM = 10,
    INTAKE_HIGH = 11
}
