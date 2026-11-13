import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import NavLink from "./NavLink";
import ThemeToggle from "./ThemeToggle";
import NavButton from "./NavButton";

const Navbar = ({ theme, setTheme }) => {
    const navigate = useNavigate();

    return (
        <nav className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-7xl -translate-x-1/2">
            <div className="nav-glass flex min-h-14 flex-wrap items-center justify-between gap-y-1.5 px-3 py-2 md:h-14 md:py-0 md:px-5">
                {/* Brand */}
                <div className="flex flex-row justify-center items-center gap-4.5">
                    <a href="#" className="flex items-center gap-2.5 cursor-pointer">
                        <p className="font-ui text-2xl font-semibold tracking-[-0.02em] text-(--foreground)">
                            Gradia
                        </p>
                    </a>
                    <p className="text-xs text-(--muted)">
                        Academic suite
                    </p>
                </div>
                {/* Navigation */}
                <div className="hidden items-center gap-7 md:flex">
                    <NavLink label="Product" href="#product" />
                    <NavLink label="How it works" href="#how-it-works" />
                    <NavLink label="Features" href="#features" />
                    <NavLink label="Security" href="#security" />
                </div>
                {/* Actions */}
                <div className="flex items-center gap-2">
                    {/* Theme */}
                    <ThemeToggle theme={theme} setTheme={setTheme} />
                    {/* Sign in */}
                    <NavButton variant="secondary" onClick={() => navigate("/login")}>
                        Sign in
                    </NavButton>

                    <Link to="/request-demo">
                      <NavButton>
                        Request demo
                      </NavButton>
                    </Link>
                </div>
            </div>
        </nav>
    );
};

export default Navbar;