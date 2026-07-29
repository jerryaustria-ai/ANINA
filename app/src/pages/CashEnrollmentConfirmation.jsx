import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";

export default function CashEnrollmentConfirmation() {
  const [params] = useSearchParams();
  const [state, setState] = useState({ loading: true, order: null, error: "", code: "" });
  const token = params.get("token") || "";

  useEffect(() => {
    api("/guest-checkout/cash-confirm", { method: "POST", body: { token } })
      .then(({ order }) => setState({ loading: false, order, error: "", code: "" }))
      .catch((error) => setState({
        loading: false, order: null, error: error.message, code: error.code || "",
      }));
  }, [token]);

  if (state.loading) return <div className="guest-state">Confirming your enrollment…</div>;
  return <div className="guest-state">
    {state.order ? <>
      <h1>Enrollment confirmed</h1>
      <p>Your enrollment is active and your payment status is <strong>Pending Cash Payment</strong>.</p>
      <p>Booking reference: <strong>{state.order.referenceId}</strong></p>
    </> : <>
      <h1>{state.code === "CASH_CONFIRM_EXPIRED" ? "Confirmation link expired" : "Unable to confirm enrollment"}</h1>
      <p>{state.error}</p>
    </>}
    <Link className="btn" to="/">Return to Home</Link>
  </div>;
}
