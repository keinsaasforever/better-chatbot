import ResetPassword from "@/components/auth/reset-password";
import { Suspense } from "react";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPassword />
    </Suspense>
  );
}
