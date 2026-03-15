/**
 * Device role within a zone (byte 17 of the 21-byte status packet).
 *
 * Source: Ambientika Smart APP manual (P06506000, EN October 2023)
 *
 * Each zone must have exactly one MASTER. All other devices are slaves.
 * Commands must always be sent to the MASTER — it propagates them to slaves.
 *
 * In MASTER_SLAVE_FLOW / SLAVE_MASTER_FLOW modes:
 *   MASTER and SLAVE_EQUAL_MASTER flow in the same direction;
 *   SLAVE_OPPOSITE_MASTER flows in the opposite direction.
 */
export enum DeviceRole {
    /** Primary device. Detects environmental parameters and receives all commands. */
    MASTER = 0,

    /** Secondary device that runs in the same airflow direction as the master. */
    SLAVE_EQUAL_MASTER = 1,

    /** Secondary device that runs in the opposite airflow direction to the master.
     *  Used to create cross-room ventilation in MASTER_SLAVE_FLOW / SLAVE_MASTER_FLOW modes. */
    SLAVE_OPPOSITE_MASTER = 2
}
