import { DreoProfileType, DreoProfiles } from '../../src/fan/DreoProfile';
import { DreoAPI } from '../../src/fan/DreoAPI';

jest.mock('../../src/fan/DreoAPI', () => {
    return {
        DreoAPI: jest.fn().mockImplementation(() => ({
        airCirculatorCommand: jest.fn().mockResolvedValue(true)
        }))
    };
});

describe('DreoProfiles', () => {
    const serial = 'ABC123';
    let dreoInstance: any;

    beforeEach(() => {
        dreoInstance = new DreoAPI({ 
            logger: console,         // or a mock logger
            email: 'test@example.com',
            password: 'secret',
            server: 'us',
            serialNumber: 'ABC123'
        } as any); // <-- use `as any` to skip type details, or import DreoConfig
        jest.clearAllMocks();
    });

    it('should apply CENTER_0 profile', async () => {
        await DreoProfiles[DreoProfileType.CENTER_0].apply(serial, dreoInstance, 3);
        expect(dreoInstance.airCirculatorCommand).toHaveBeenCalledWith(
            serial,
            expect.objectContaining({
                fixedconf:'0,0',
                cruiseconf: '45,15,15,-15',
                oscmode: 0,
                windlevel: 3
            })
        );
    });
    
    it('should apply CENTER_30 profile', async () => {
        await DreoProfiles[DreoProfileType.CENTER_30].apply(serial, dreoInstance, 5);
        expect(dreoInstance.airCirculatorCommand).toHaveBeenCalledWith(
            serial,
            expect.objectContaining({ 
                fixedconf: '30,0',
                cruiseconf: '45,15,15,-15',
                oscmode: 0, 
                windlevel: 5
            })
        );
    });
    
    it('should apply CENTER_45 profile', async () => {
        await DreoProfiles[DreoProfileType.CENTER_45].apply(serial, dreoInstance, 7);
        expect(dreoInstance.airCirculatorCommand).toHaveBeenCalledWith(
            serial,
            expect.objectContaining({
                fixedconf: '45,0',
                cruiseconf: '45,15,15,-15',
                oscmode: 0,
                windlevel: 7
            })
        );
    });
    
    it('should apply VERTICAL profile', async () => {
        await DreoProfiles[DreoProfileType.VERTICAL].apply(serial, dreoInstance, 9);
        expect(dreoInstance.airCirculatorCommand).toHaveBeenCalledWith(
            serial,
            expect.objectContaining({
                fixedconf: '30,0',
                cruiseconf: '45,15,15,-15',
                oscmode: 2,
                windlevel: 9
            })
        );
    });
});
