import {HaAutoDiscoverInterface} from './ha-auto-discover.interface';

export interface HaAutoDiscoverClimateInterface extends HaAutoDiscoverInterface {
    action_topic: string;
    availability_topic: string;
    current_humidity_topic: string;
    target_humidity_state_topic: string;
    target_humidity_command_topic: string;
    current_temperature_topic: string;
    fan_mode_state_topic: string;
    fan_mode_command_topic: string;
    mode_state_topic: string;
    mode_command_topic: string;
    preset_mode_state_topic: string;
    preset_mode_command_topic: string;
    preset_modes: string[];
    modes: string[];
    fan_modes: string[];
}
