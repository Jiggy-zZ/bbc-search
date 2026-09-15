interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function SearchInput({ value, onChange, onSubmit }: SearchInputProps) {
  return (
    <form
      className="search-form"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="sr-only" htmlFor="subtitle-search">
        Search English or Chinese subtitles
      </label>
      <div className="search-control">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21">
          <path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
        </svg>
        <input
          id="subtitle-search"
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search a quote in English or 中文…"
          autoComplete="off"
          maxLength={120}
        />
        <span className="key-hint" aria-hidden="true">Enter</span>
      </div>
    </form>
  );
}
