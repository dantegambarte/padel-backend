import { Logger } from '@nestjs/common';

import { RemindersCronService } from './reminders-cron.service';
import { RemindersService } from './reminders.service';

describe('RemindersCronService', () => {
  const item = {
    bookingId: 'booking-123',
    clientName: 'Jane Client',
    phoneNumber: '1155550000',
    hour: 20,
    courtName: 'Court 1',
    date: '2026-11-18',
  };

  afterEach(() => jest.restoreAllMocks());

  it('logs booking ids but never client name or phone number', async () => {
    const remindersService = {
      getUpcomingForCron: jest.fn().mockResolvedValue({ alert24h: [item], alertSameDay: [item] }),
    } as unknown as RemindersService;
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await new RemindersCronService(remindersService).handleHourlyReminders();

    const output = logSpy.mock.calls.map((args) => JSON.stringify(args)).join('\n');
    expect(logSpy).toHaveBeenCalled();
    expect(output).toContain('booking-123');
    expect(output).not.toContain('Jane Client');
    expect(output).not.toContain('1155550000');
  });
});
