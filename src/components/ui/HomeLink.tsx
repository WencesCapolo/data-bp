/** Arrow-only "back" link. Dashboards return to the analytics landing (`/`);
 *  the landing itself leaves the subdomain for the base domain. */
export const BASE_DOMAIN_URL = 'https://basket-app.com';

interface Props {
  href: string;
  title: string;
}

export function HomeLink({ href, title }: Props) {
  return (
    <a href={href} className="btn-ghost" style={{ textDecoration: 'none' }} title={title} aria-label={title}>
      ←
    </a>
  );
}
