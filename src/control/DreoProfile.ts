/**
 * Defines different profiles for the Dreo air circulator.
 * A profile is a set of oscilating configurations to be
 * applied to the air circulator.
 */
import { DreoAPI, DreoCommand } from './DreoAPI';

// This is the cruise parameters used in this context
// Horizontal -15 to 15
// Vertical 15 to 65
// Cruise horizongal [0, 30]
// Cruise vertical [30, 30]
const oscMode = {
    oscmode: 0
} as DreoCommand;
const fixedConf = {
    fixedconf: '0,0'
} as DreoCommand;

export abstract class DreoProfile {
    protected name: string;
    // All implementations must be async
    abstract apply(dreoSerialNumber: string, dreoApi: DreoAPI, fanSpeed: number): Promise<void>;
    toString(): string {
        return this?.name;
    }
}

class OscillateHorizontalProfile extends DreoProfile {
    name = 'OSCILATE_HORIZONTAL';
    async apply(serialNumber: string, dreoApi: DreoAPI, fanSpeed: number) {
        // Create a command template for this profile
        const template: DreoCommand = {
            fixedconf: '30,0', // Set position (equivalent to position [0,30])
            cruiseconf: '45,15,15,-15', // Set cruise mode (equivalent to CRUISE_HORIZONTAL, CRUISE_VERTICAL)
            oscmode: 1, // Set oscillation (equivalnt to AirCirculatorOscillation.HORIZONTAL)
            windlevel: fanSpeed
        };
        await dreoApi.airCirculatorCommand(serialNumber, template);
    }
}

class OscillateVerticalProfile extends DreoProfile {
    name = 'OSCILATE_VERTICAL';
    async apply(serialNumber: string, dreoApi: DreoAPI, fanSpeed: number) {
        // Create a command template for this profile
        const template: DreoCommand = {
            fixedconf: '30,0', // Set position (equivalent to position [0,30])
            cruiseconf: '45,15,15,-15', // Set cruise mode (equivalent to CRUISE_HORIZONTAL, CRUISE_VERTICAL)
            oscmode: 2, // Set oscillation (equivalnt to AirCirculatorOscillation.VERTICAL)
            windlevel: fanSpeed
        };
        await dreoApi.airCirculatorCommand(serialNumber, template);
    }
}

class OscillateHorizontalVerticalProfile extends DreoProfile {
    name = 'OSCILATE_HORIZONTAL_VERTICAL';
    async apply(serialNumber: string, dreoApi: DreoAPI, fanSpeed: number) {
        // Create a command template for this profile
        const template: DreoCommand = {
            fixedconf: '30,0', // Set position (equivalent to position [0,30])
            cruiseconf: '45,15,15,-15', // Set cruise mode (equivalent to CRUISE_HORIZONTAL, CRUISE_VERTICAL)
            oscmode: 3, // Set oscillation (equivalnt to AirCirculatorOscillation.HORIZONTAL_VERTICAL)
            windlevel: fanSpeed
        };
        await dreoApi.airCirculatorCommand(serialNumber, template);
    }
}

class Center45Degrees extends DreoProfile {
    name = 'CENTER_45_DEGREE';
    async apply(serialNumber: string, dreoApi: DreoAPI, fanSpeed: number) {
        // Create a command template for this profile
        const template: DreoCommand = {
            fixedconf: '45,0', // Set position (equivalent to position [0,45])
            cruiseconf: '45,15,15,-15', // Set cruise mode (equivalent to CRUISE_HORIZONTAL, CRUISE_VERTICAL)
            oscmode: 0, // Set oscillation (equivalnt to AirCirculatorOscillation.NONE)
            windlevel: fanSpeed
        };
        await dreoApi.airCirculatorCommand(serialNumber, oscMode);
        await dreoApi.airCirculatorCommand(serialNumber, fixedConf);
        await dreoApi.airCirculatorCommand(serialNumber, template);
    }
}

class Center30Degrees extends DreoProfile {
    name = 'CENTER_30_DEGREE';
    async apply(serialNumber: string, dreoApi: DreoAPI, fanSpeed: number) {
        // Create a command template for this profile
        const template: DreoCommand = {
            fixedconf: '30,0', // Set position (equivalent to position [0,30])
            cruiseconf: '45,15,15,-15', // Set cruise mode (equivalent to CRUISE_HORIZONTAL, CRUISE_VERTICAL)
            oscmode: 0, // Set oscillation (equivalnt to AirCirculatorOscillation.NONE)
            windlevel: fanSpeed
        };
        await dreoApi.airCirculatorCommand(serialNumber, oscMode);
        await dreoApi.airCirculatorCommand(serialNumber, fixedConf);
        await dreoApi.airCirculatorCommand(serialNumber, template);
    }
}

class Center0Degrees extends DreoProfile {
    name = 'CENTER_0_DEGREE';
    async apply(serialNumber: string, dreoApi: DreoAPI, fanSpeed: number) {
        // Create a command template for this profile
        const template: DreoCommand = {
            fixedconf: '0,0', // Set position (equivalent to position [0,0])
            cruiseconf: '45,15,15,-15', // Set cruise mode (equivalent to CRUISE_HORIZONTAL, CRUISE_VERTICAL)
            oscmode: 0, // Set oscillation (equivalnt to AirCirculatorOscillation.NONE)
            windlevel: fanSpeed
        };
        await dreoApi.airCirculatorCommand(serialNumber, oscMode);
        await dreoApi.airCirculatorCommand(serialNumber, fixedConf);
        await dreoApi.airCirculatorCommand(serialNumber, template);
    }
}

export enum DreoProfileType { 'CENTER_0', 'CENTER_30', 'CENTER_45', 'HORIZONTAL', 'VERTICAL', 'HORIZONTAL_VERTICAL' }

export const DreoProfiles = {
    [DreoProfileType.HORIZONTAL]: new OscillateHorizontalProfile(),
    [DreoProfileType.VERTICAL]: new OscillateVerticalProfile(),
    [DreoProfileType.HORIZONTAL_VERTICAL]: new OscillateHorizontalVerticalProfile(),
    [DreoProfileType.CENTER_45]: new Center45Degrees(),
    [DreoProfileType.CENTER_30]: new Center30Degrees(),
    [DreoProfileType.CENTER_0]: new Center0Degrees()
}
