/** Phones only: Android tablets keep the same explicit choice as desktops. */
export function isAndroidPhone(device: {
  userAgent: string;
  userAgentData?: { mobile?: boolean; platform?: string };
}) {
  const ua = device.userAgent;
  if (/Tablet|Nexus 7|Nexus 9|Nexus 10|SM-T\w+|Kindle|Silk\//i.test(ua)) return false;
  const android = /Android/i.test(ua) || device.userAgentData?.platform === 'Android';
  return android && (device.userAgentData?.mobile ?? /Mobile/i.test(ua));
}
