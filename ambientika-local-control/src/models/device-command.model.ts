export class DeviceCommand {
    serialNumber: string;
    operatingMode: string;
    fanSpeed: string;
    humidityLevel: string
    lightSensitivity: string

    constructor(serialNumber: string, operatingMode: string, fanSpeed: string, humidityLevel: string, lightSensitivity: string) {
        this.serialNumber = serialNumber;
        this.operatingMode = operatingMode;
        this.fanSpeed = fanSpeed;
        this.humidityLevel = humidityLevel;
        this.lightSensitivity = lightSensitivity;
    }
}
