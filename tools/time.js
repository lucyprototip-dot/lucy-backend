module.exports = {
  name: "time",
  description: "Şu anki tarih ve saati verir",

  async execute(input = {}) {
    const locale = input.locale || "tr-TR";
    const timeZone = input.timeZone || "Europe/Istanbul";

    return {
      success: true,
      time: new Date().toLocaleString(locale, { timeZone }),
      timeZone,
    };
  },
};
