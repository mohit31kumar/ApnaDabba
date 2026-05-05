export const validators = {
  is10DigitIndianPhone: (phone: string): boolean => {
    return /^[6-9]\d{9}$/.test(phone);
  },
  
  isUUID: (uuid: string): boolean => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
  }
};