export interface HaAutoDiscoverInterface {
    name: string | null;
    unique_id: string;
    device_class?: string;
    device: {
        identifiers: string[];
        serial_number?: string;
        manufacturer?: string;
        via_device?: string;
    }
}
