import { PrivacyService, ANONYMIZED_NAME } from './privacy.service';

type QB = Record<string, jest.Mock>;

function makeQb(result: unknown): QB {
  const qb = {} as QB;
  for (const m of ['update', 'set', 'where', 'andWhere', 'select', 'leftJoin']) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.execute = jest.fn().mockResolvedValue(result);
  qb.getMany = jest.fn().mockResolvedValue(result);
  return qb;
}

describe('PrivacyService', () => {
  const NOW = new Date('2026-06-01T00:00:00.000Z');
  let fixedQb: QB;
  let teacherQb: QB;
  let bookingQb: QB;
  let fixedRepo: { createQueryBuilder: jest.Mock };
  let teacherRepo: { createQueryBuilder: jest.Mock };
  let bookingRepo: { createQueryBuilder: jest.Mock };
  let service: PrivacyService;

  function build(fixed: unknown, teacher: unknown, booking: unknown = { affected: 0 }) {
    fixedQb = makeQb(fixed);
    teacherQb = makeQb(teacher);
    bookingQb = makeQb(booking);
    fixedRepo = { createQueryBuilder: jest.fn(() => fixedQb) };
    teacherRepo = { createQueryBuilder: jest.fn(() => teacherQb) };
    bookingRepo = { createQueryBuilder: jest.fn(() => bookingQb) };
    service = new PrivacyService(fixedRepo as never, teacherRepo as never, bookingRepo as never);
  }

  describe('purgeExpiredPhones', () => {
    it('nulls phones of inactive fixed bookings and teachers untouched past the retention', async () => {
      build({ affected: 2 }, { affected: 1 });

      const result = await service.purgeExpiredPhones(30, NOW);

      expect(result).toEqual({ fixedBookings: 2, teachers: 1 });
      expect(fixedQb.set).toHaveBeenCalledWith({ phoneNumber: null });
      expect(teacherQb.set).toHaveBeenCalledWith({ phoneNumber: null });
      const cutoff = new Date('2026-05-02T00:00:00.000Z');
      for (const qb of [fixedQb, teacherQb]) {
        expect(qb.where).toHaveBeenCalledWith('is_active = false');
        expect(qb.andWhere).toHaveBeenCalledWith('phone_number IS NOT NULL');
        expect(qb.andWhere).toHaveBeenCalledWith('updated_at < :cutoff', { cutoff });
      }
    });

    it('rejects a non-positive retention', async () => {
      build({ affected: 0 }, { affected: 0 });
      await expect(service.purgeExpiredPhones(0, NOW)).rejects.toThrow();
      expect(fixedRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('exportByPhone', () => {
    it('returns every record holding the phone, matched by digits only', async () => {
      const fixed = [{ id: 'f1', clientName: 'Ana', phoneNumber: '+54 11 5555' }];
      const teachers = [{ id: 't1', fullName: 'Prof', phoneNumber: '54115555' }];
      build(fixed, teachers);

      const result = await service.exportByPhone('+54 (11) 5555');

      expect(result).toEqual({ phone: '54115555', fixedBookings: fixed, teachers });
      expect(fixedQb.where).toHaveBeenCalledWith(
        "regexp_replace(phone_number, '\\D', '', 'g') = :digits",
        { digits: '54115555' },
      );
    });

    it('rejects a phone without digits', async () => {
      build([], []);
      await expect(service.exportByPhone('abc')).rejects.toThrow();
    });
  });

  describe('eraseByPhone', () => {
    it('nulls the phone everywhere and anonymizes fixed-booking names and their bookings', async () => {
      build([{ id: 'f1' }, { id: 'f2' }], { affected: 1 }, { affected: 5 });
      fixedQb.execute.mockResolvedValue({ affected: 2 });

      const result = await service.eraseByPhone('11-5555');

      expect(result).toEqual({ fixedBookings: 2, teachers: 1, bookings: 5 });
      expect(fixedQb.set).toHaveBeenCalledWith({ phoneNumber: null, clientName: ANONYMIZED_NAME });
      expect(teacherQb.set).toHaveBeenCalledWith({ phoneNumber: null });
      expect(bookingQb.set).toHaveBeenCalledWith({ clientName: ANONYMIZED_NAME });
      expect(bookingQb.where).toHaveBeenCalledWith('fixed_booking_id IN (:...ids)', {
        ids: ['f1', 'f2'],
      });
    });

    it('skips bookings when no fixed booking matches', async () => {
      build([], { affected: 0 });
      fixedQb.execute.mockResolvedValue({ affected: 0 });

      const result = await service.eraseByPhone('115555');

      expect(result).toEqual({ fixedBookings: 0, teachers: 0, bookings: 0 });
      expect(bookingRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
