export function GET(request: Request) {
  const appOrigin = new URL(request.url).origin;
  const script = `(() => {
  const script = document.currentScript;
  if (!script) return;

  const appOrigin = ${JSON.stringify(appOrigin)};
  const fields = [
    ["amountIls", "amountILS"],
    ["amount", "amountILS"],
    ["businessId", "businessId"],
    ["description", "description"],
    ["transactionId", "transactionId"],
    ["fullName", "fullName"],
    ["phone", "phone"],
    ["email", "email"],
    ["currency", "cryptoCurrency"],
    ["network", "network"]
  ];
  const params = new URLSearchParams();

  for (const [dataKey, queryKey] of fields) {
    const value = script.dataset[dataKey];
    if (value) params.set(queryKey, value);
  }

  const sizes = {
    sm: {
      minHeight: "40px",
      padding: "0 16px",
      gap: "8px",
      font: "700 13px/1.2 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      iconSize: "22px",
      iconFontSize: "14px"
    },
    md: {
      minHeight: "48px",
      padding: "0 22px",
      gap: "10px",
      font: "700 15px/1.2 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      iconSize: "26px",
      iconFontSize: "16px"
    },
    lg: {
      minHeight: "58px",
      padding: "0 28px",
      gap: "12px",
      font: "800 17px/1.2 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      iconSize: "32px",
      iconFontSize: "19px"
    }
  };
  const size = sizes[script.dataset.size] || sizes.md;
  const fullWidth = script.dataset.fullWidth === "true";
  const width = script.dataset.width || (fullWidth ? "100%" : "auto");
  const borderRadius = script.dataset.radius || "999px";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = script.dataset.label || "Pay with Crypto";
  button.setAttribute("aria-label", button.textContent);
  button.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "gap:" + size.gap,
    "min-height:" + size.minHeight,
    "width:" + width,
    "padding:" + size.padding,
    "border:0",
    "border-radius:" + borderRadius,
    "background:linear-gradient(135deg,#10b981,#059669)",
    "color:#ffffff",
    "font:" + size.font,
    "letter-spacing:.01em",
    "box-shadow:0 14px 32px rgba(5,150,105,.28)",
    "cursor:pointer",
    "transition:transform .18s ease,box-shadow .18s ease,filter .18s ease"
  ].join(";");

  const icon = document.createElement("span");
  icon.textContent = "₿";
  icon.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:" + size.iconSize + ";height:" + size.iconSize + ";border-radius:999px;background:rgba(255,255,255,.18);font-weight:800;font-size:" + size.iconFontSize;
  button.prepend(icon);

  button.addEventListener("mouseenter", () => {
    button.style.transform = "translateY(-1px)";
    button.style.boxShadow = "0 18px 38px rgba(5,150,105,.34)";
    button.style.filter = "brightness(1.02)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.transform = "translateY(0)";
    button.style.boxShadow = "0 14px 32px rgba(5,150,105,.28)";
    button.style.filter = "brightness(1)";
  });
  button.addEventListener("click", () => {
    const paymentUrl = new URL("/", appOrigin);
    paymentUrl.search = params.toString();
    const target = script.dataset.target || "_blank";

    if (target === "_self") {
      window.location.href = paymentUrl.toString();
      return;
    }

    window.open(paymentUrl.toString(), target, "noopener,noreferrer");
  });

  script.insertAdjacentElement("afterend", button);
})();`;

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
