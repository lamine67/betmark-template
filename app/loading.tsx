import Loader from "../components/Loader";

// Показывается Next.js при переходе между разделами, пока страница подгружается
export default function Loading() {
  return (
    <div className="ball-loader-page">
      <Loader size={170} label="Загрузка…" />
    </div>
  );
}
