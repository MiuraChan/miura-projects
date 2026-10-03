const dependencyOrder = Object.freeze([
  ["brain", "CERVELLO"],
  ["voice", "VOCE"],
  ["hearing", "ASCOLTO"],
]);

function joinItalian(items) {
  if (items.length <= 1) return items[0] || "SERVIZI LOCALI";
  if (items.length === 2) return `${items[0]} E ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} E ${items.at(-1)}`;
}

export function describeRuntimeHealth(payload) {
  const ready = Boolean(payload?.ok === true && payload?.code === "READY");
  if (ready) {
    return {
      ready: true,
      status: "STANDBY",
      message: "",
      pending: [],
    };
  }

  const dependencies = payload?.dependencies && typeof payload.dependencies === "object"
    ? payload.dependencies
    : {};
  const pending = dependencyOrder
    .filter(([key]) => dependencies[key]?.ok !== true)
    .map(([, label]) => label);

  return {
    ready: false,
    status: "AVVIO LOCALE",
    message: `PREPARO ${joinItalian(pending)}…`,
    pending,
  };
}

export function describeRuntimeConnection() {
  return {
    ready: false,
    status: "AVVIO LOCALE",
    message: "COLLEGO I SERVIZI LOCALI…",
    pending: dependencyOrder.map(([, label]) => label),
  };
}
