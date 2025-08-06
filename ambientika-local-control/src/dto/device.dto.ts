export interface DeviceDto {
    id: number;
    serialNumber: string;
    status: string;
    lastUpdate: string;
    firstSeen: string;
    operatingMode: string;
    fanSpeed: string;
    humidityLevel: string;
    temperature: number;
    humidity: number;
    airQuality: string;
    humidityAlarm: boolean;
    filterStatus: string;
    nightAlarm: boolean;
    deviceRole: string;
    remoteAddress: string;
    lastOperatingMode: string;
    lightSensitivity: string;
    houseId: number;
    zoneId: number;
}
