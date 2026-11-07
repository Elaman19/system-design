// Usage: node scripts/receipt-probe.mjs [api-url] [mailpit-url] [limit-seconds]
// Synthetic check of the receipt path (docs/observability, 2.2): makes one real deal
// through the API, then waits for its receipt in Mailpit by Message-ID
// <receipt-<deal>@marketplace.local>. Prints the time from the deal to the mail.
// Exit code 1 if the mail was not seen within the limit (default 300 s, the SLI
// boundary) or any API call failed. "Within" is judged by this script's clock when it
// sees the mail, never by the mere fact that a mail exists: a receipt found after the
// limit is BAD. Every HTTP call has its own timeout, so a hung API or Mailpit cannot keep
// the probe past the limit either. Each run creates its own seller, buyer and lot:
// never point it at production, the deal moves money.
// Defaults match the Compose stack seen from the host: API :3000, Mailpit UI :8025.
const api = process.argv[2] ?? 'http://localhost:3000';
const mailpit = process.argv[3] ?? 'http://localhost:8025';
const limitMs = Number(process.argv[4] ?? 300) * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const POLL_MS = 500;
const run = Date.now();

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status} ${JSON.stringify(json)}`,
    );
  }
  return json;
}

// One search; a slow or failing Mailpit is "not seen yet", the deadline decides.
async function findReceipt(dealId, timeoutMs) {
  const query = encodeURIComponent(
    `message-id:receipt-${dealId}@marketplace.local`,
  );
  try {
    const res = await fetch(`${mailpit}/api/v1/search?query=${query}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Mailpit search -> ${res.status}`);
    const { messages } = await res.json();
    return messages[0];
  } catch (error) {
    console.error(`mailpit: ${error.message}`);
    return undefined;
  }
}

try {
  const seller = await call('POST', '/companies', {
    name: `probe seller ${run}`,
    email: `probe-seller-${run}@probe.local`,
  });
  const buyer = await call('POST', '/companies', {
    name: `probe buyer ${run}`,
    email: `probe-buyer-${run}@probe.local`,
  });
  await call('POST', `/companies/${buyer.id}/wallet/deposits`, {
    bankNotificationId: `probe-${run}`,
    amount: 100,
  });
  const lot = await call('POST', '/lots', {
    sellerId: seller.id,
    title: `probe lot ${run}`,
    price: 100,
    stock: 1,
  });
  await call('PATCH', `/lots/${lot.id}/publication`, { published: true });

  const dealAt = Date.now();
  const deal = await call('POST', '/deals', {
    buyerId: buyer.id,
    lotId: lot.id,
    quantity: 1,
  });

  const deadline = dealAt + limitMs;
  let mail;
  let seenAt;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    mail = await findReceipt(deal.id, Math.min(left, REQUEST_TIMEOUT_MS));
    seenAt = Date.now();
    if (mail || seenAt >= deadline) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(POLL_MS, deadline - seenAt)),
    );
  }
  const seconds = (((seenAt ?? Date.now()) - dealAt) / 1000).toFixed(1);
  // The check of the clock comes first: a mail seen after the deadline is late.
  if (!mail || seenAt > deadline) {
    console.log(
      mail
        ? `deal ${deal.id}: receipt seen only after ${seconds}s, limit ${limitMs / 1000}s -> BAD`
        : `deal ${deal.id}: no receipt in Mailpit after ${seconds}s -> BAD`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `deal ${deal.id}: receipt to ${mail.To[0].Address} after ${seconds}s -> GOOD`,
    );
    console.log(`subject: ${mail.Subject}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
