import { Link } from 'react-router-dom';

export default function AppFooter() {
  return (
    <footer className="border-t border-border bg-background py-1 mt-auto">
      <div className="container mx-auto px-1 flex flex-col md:flex-row justify-between items-center gap-2">
        <p className="text-xs text-muted-foreground">
          Powered by Eddy • HKFC Men's Hockey Squad Management
        </p>
        <p className="text-xs text-muted-foreground">
          Questions? Contact us at{' '}
          <a
            href="mailto:info@eddy.global"
            className="text-primary hover:underline"
          >
            info@eddy.global
          </a>
        </p>
      </div>
    </footer>
  );
}