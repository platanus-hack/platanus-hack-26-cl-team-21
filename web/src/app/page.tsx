export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">Observatorio Longitudinal Multimodal</h1>
      <p>Portal de investigadores — hello world.</p>
      <a className="underline" href="/api/health">
        /api/health
      </a>
    </main>
  );
}
