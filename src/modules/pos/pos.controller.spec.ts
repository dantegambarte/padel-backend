import { PosController } from './pos.controller';
import { PosService } from './pos.service';

describe('PosController — findByDate', () => {
  const posService = { findByDate: jest.fn() };
  const controller = new PosController(posService as unknown as PosService);

  afterEach(() => {
    jest.useRealTimers();
    posService.findByDate.mockReset();
  });

  it('defaults to the Argentina date at 22:00 ART, when UTC is already tomorrow', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-11T01:00:00Z'));
    void controller.findByDate({});
    expect(posService.findByDate).toHaveBeenCalledWith('2026-03-10');
  });

  it('uses the requested date when one is given', () => {
    void controller.findByDate({ date: '2026-01-05' });
    expect(posService.findByDate).toHaveBeenCalledWith('2026-01-05');
  });
});
