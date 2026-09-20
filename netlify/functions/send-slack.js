// POST /send-slack — post the summary to the branch channel, and send the
// full denomination breakdown privately to the manager DM.

const { verifyToken, json, requirePost, parseBody } = require("./_auth");

const SLACK_CHANNELS = {
  Solaire: "C0B734364T0",
  Alphaland: "C06NDDD1D0U",
};

const MANAGER_USER_ID = "U0B8SV8CG9L"; // Corporate Psulit — receives breakdowns

async function postToSlack(token, payload) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

exports.handler = async (event) => {
  const wrongMethod = requirePost(event);
  if (wrongMethod) return wrongMethod;

  const session = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!session) {
    return json(401, { ok: false, error: "Session expired. Please log in again." });
  }

  const body = parseBody(event);
  if (!body) return json(400, { ok: false, error: "Bad request." });

  const { branch, message, breakdown } = body;

  const slackToken = process.env.SLACK_TOKEN;
  if (!slackToken) {
    console.error("SLACK_TOKEN is not set.");
    return json(500, { ok: false, error: "Slack is not configured on the server." });
  }

  const channelId = SLACK_CHANNELS[branch];
  if (!channelId) {
    return json(400, { ok: false, error: `Unknown branch: ${branch}` });
  }

  try {
    // Summary to the branch channel.
    const summary = await postToSlack(slackToken, { channel: channelId, text: message });
    if (!summary.ok) {
      console.error("Slack channel post failed:", summary.error);
      return json(502, { ok: false, error: `Slack: ${summary.error}` });
    }

    // Full breakdown to the manager DM. If this fails the count is still
    // recorded in the channel, so report success and log the problem.
    if (breakdown) {
      try {
        const dm = await postToSlack(slackToken, { channel: MANAGER_USER_ID, text: breakdown });
        if (!dm.ok) console.error("Slack DM failed:", dm.error);
      } catch (e) {
        console.error("Slack DM threw:", e.message);
      }
    }

    return json(200, { ok: true });
  } catch (e) {
    console.error("send-slack failed:", e.message);
    return json(502, { ok: false, error: "Could not reach Slack." });
  }
};
