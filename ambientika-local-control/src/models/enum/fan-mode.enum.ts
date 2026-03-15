/**
 * Fan operating mode reported in UDP broadcast packets (upper nibble of byte 2).
 * Describes the current airflow direction pattern.
 *
 * Note: value 1 is not used.
 */
export enum FanMode {
    /** Fan is stopped. */
    OFF = 0,

    /** Fan alternates between intake and expulsion (heat recovery / HRV mode). */
    ALTERNATING = 2,

    /** Fan runs continuously in one direction (expulsion or intake only). */
    PERMANENT = 3
}
