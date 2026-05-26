module.exports = {
  name: "time",
  description: "Şu anki tarih ve saati verir",

  async execute() {
    return {
      success: true,
      time: new Date().toLocaleString("tr-TR"),
      iso: new Date().toISOString(),
    };
  },
};
