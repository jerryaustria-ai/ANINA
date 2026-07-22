import { Router } from "express";
import { Membership } from "../models/Membership.js";
import { asyncHandler } from "../utils/http.js";
import { normalizeEvent, applyEvent } from "../services/membership.js";

// PUBLIC (no auth) — Xendit posts subscription lifecycle events here.
// Verified with the x-callback-token header (set XENDIT_WEBHOOK_TOKEN and the
// same value in the Xendit dashboard). Configure the URL as
//   https://<your-public-host>/api/webhooks/xendit
// Locally, expose it with a tunnel (ngrok/cloudflared) or use the dev simulator.
const router = Router();

router.post(
  "/xendit",
  asyncHandler(async (req, res) => {
    const expected = process.env.XENDIT_WEBHOOK_TOKEN || "";
    if (expected && req.get("x-callback-token") !== expected) {
      return res.status(401).json({ error: "Invalid callback token" });
    }

    const body = req.body || {};
    const event = normalizeEvent(body.event || body.type || "");
    // Xendit identifies the plan by its id and/or our reference_id.
    const data = body.data || body;
    const planId = data.plan_id || data.id || data.recurring_plan_id;
    const referenceId = data.reference_id;

    const membership = await Membership.findOne(
      planId ? { $or: [{ xenditPlanId: planId }, { referenceId }] } : { referenceId }
    ).populate("tier");

    // Always 200 so Xendit doesn't retry storms; log unmatched events.
    if (!membership || !event) {
      console.warn("Xendit webhook unmatched:", { event: body.event, planId, referenceId });
      return res.json({ received: true, matched: false });
    }

    await applyEvent(membership, event);
    res.json({ received: true, matched: true, status: membership.status });
  })
);

export default router;
