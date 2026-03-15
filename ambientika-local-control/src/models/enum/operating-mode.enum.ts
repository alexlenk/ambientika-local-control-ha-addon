/**
 * Operating modes reported by Ambientika devices (byte 8 of the 21-byte status packet).
 *
 * Source: Ambientika Smart APP manual (P06506000, EN October 2023)
 *
 * Note: MASTER_SLAVE_FLOW and SLAVE_MASTER_FLOW can be set manually or triggered
 * automatically by SMART mode's free-cooling logic when:
 *   - Indoor temperature > 24°C
 *   - Outdoor temperature > 20°C
 *   - Outdoor temperature < Indoor temperature
 */
export enum OperatingMode {
    /** Self-managing mode: uses temperature, air quality and light sensors.
     *  Automatically switches between heat recovery and free-cooling (MASTER_SLAVE_FLOW). */
    'SMART' = 0,

    /** Humidity-controlled mode: uses humidity and twilight sensors.
     *  Humidity threshold is one of 40 % / 60 % / 75 % (DRY / NORMAL / MOIST). */
    'AUTO' = 1,

    /** Fixed heat-recovery mode at a user-selected fan speed. Sensors disabled. */
    'MANUAL_HEAT_RECOVERY' = 2,

    /** All units run at NIGHT speed in heat-recovery mode. */
    'NIGHT' = 3,

    /** Standby with damper closed; starts at LOW speed when humidity exceeds 60 %. */
    'AWAY_HOME' = 4,

    /** Standby with damper closed; expels at user-selected speed on humidity alarm. */
    'SURVEILLANCE' = 5,

    /** All units expel at HIGH speed for 20 minutes, then return to the previous mode. */
    'TIMED_EXPULSION' = 6,

    /** Continuous expulsion at a user-selected fan speed. */
    'EXPULSION' = 7,

    /** Continuous intake at a user-selected fan speed. */
    'INTAKE' = 8,

    /** Continuous airflow from MASTER / SLAVE_EQUAL_MASTER → SLAVE_OPPOSITE_MASTER.
     *  No heat recovery. Used to isolate odours in a room. */
    'MASTER_SLAVE_FLOW' = 9,

    /** Continuous airflow from SLAVE_OPPOSITE_MASTER → MASTER / SLAVE_EQUAL_MASTER.
     *  No heat recovery. Reverse of MASTER_SLAVE_FLOW. */
    'SLAVE_MASTER_FLOW' = 10,

    /** All units off; sensors disabled; damper closed. */
    'OFF' = 11,

    /** Internal sentinel — not reported by devices. */
    'LAST' = 12
}
