/**
 * Twilight / light sensor sensitivity (byte 19 of the 21-byte status packet).
 * Controls when the device switches between daytime and night-time behaviour.
 * A higher sensitivity means the device detects darkness earlier.
 */
export enum LightSensitivity {
    /** Device does not have a light sensor or sensor is not configured. */
    NOT_AVAILABLE,

    /** Light sensor disabled — device uses a fixed schedule instead. */
    OFF,

    LOW,
    MEDIUM
}
