const math = require("mathjs");

module.exports = {
  name: "calculator",
  description: "Matematiksel işlemleri güvenli şekilde hesaplar",

  async execute(input = {}) {
    const expression = String(input.expression || "").trim();

    if (!expression) {
      return {
        success: false,
        error: "expression_required",
        message: "Hesaplanacak ifade boş olamaz.",
      };
    }

    try {
      const result = math.evaluate(expression);

      return {
        success: true,
        expression,
        result,
      };
    } catch (error) {
      return {
        success: false,
        error: "calculation_failed",
        message: error.message,
      };
    }
  },
};
