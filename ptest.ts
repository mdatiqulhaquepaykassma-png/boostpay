import { parseSms } from './sms-parse';
const cases: string[] = [
  'You have received Tk 500.00 from 01712345678. Ref: ABC12345. TrxID 9A1B2C3D4E. Balance Tk 1,200.00.',
  'Tk 1,000.00 is received from 01712345678. TxnID: 8X7Y6Z5W4V. Balance Tk 5,000.00.',
  'আপনি ৫০০.০০ টাকা পেয়েছেন। প্রেরক ০১৭১২৩৪৫৬৭৮। ট্রানজেকশন আইডি: ABC1234567',
  'Nagad: You have received Tk 250 from 01812345678. TrxID: NG7A8B9C0D',
  'Your bKash OTP is 123456. Do not share it with anyone.',
  'You have sent Tk 300.00 to 01712345678. TrxID 5K4L3M2N1P.',
  'bKash: Tk 50.00 received from 01911111111. TrxID A1B2C3D4E5.'
];
for (const c of cases) console.log(JSON.stringify(parseSms(c)));
