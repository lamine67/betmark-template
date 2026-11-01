// Логотип
export default function Logo({
  className = "",
  variant = "default",
}: {
  className?: string;
  variant?: "default" | "dark";
}) {
  if (variant === "dark") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/betmark-logo-white.png" alt="Betmark" width={640} height={213} className={`brand-logo-img ${className}`} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/betmark-logo.png" alt="Betmark" width={640} height={213} className={`brand-logo-img logo-on-light ${className}`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/betmark-logo-white.png" alt="" aria-hidden="true" loading="lazy" width={640} height={213} className={`brand-logo-img logo-on-dark ${className}`} />
    </>
  );
}
