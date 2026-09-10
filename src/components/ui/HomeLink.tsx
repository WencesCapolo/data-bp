/** Arrow-only "back" link, styled after the portal's `Volver` button: a
 *  bordered surface box with a 20px arrow. Dashboards return to the analytics
 *  landing (`/`); the landing itself leaves the subdomain for the base domain. */
export const BASE_DOMAIN_URL = 'https://basket-app.com';

interface Props {
  href: string;
  title: string;
}

export function HomeLink({ href, title }: Props) {
  return (
    <a href={href} className="back-link" title={title} aria-label={title}>
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m12 19-7-7 7-7" />
        <path d="M19 12H5" />
      </svg>
    </a>
  );
}
