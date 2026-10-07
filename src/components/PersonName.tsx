import { Link } from 'react-router-dom';

/**
 * A person's name: a link to their person page when `href` is set (see
 * personPageHref), else plain text. The link is raised above a row's
 * stretched button (absolute, inset-0), so it is never inside the button.
 */
export default function PersonName({ name, href }: { name: string; href: string | null }) {
  if (!href) return <>{name}</>;
  return (
    <Link to={href} className="relative z-10 hover:underline">
      {name}
    </Link>
  );
}
