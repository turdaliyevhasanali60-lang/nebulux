import React from 'react'
import Navbar from './Navbar.jsx'
import Footer from './Footer.jsx'
import BoycottNotice from './BoycottNotice.jsx'
import AccountModal from './modals/AccountModal.jsx'
import SignoutModal from './modals/SignoutModal.jsx'
import ConfirmDeleteModal from './modals/ConfirmDeleteModal.jsx'
import ErrorModal from './modals/ErrorModal.jsx'

/**
 * Layout — equivalent to base.html
 *
 * Props:
 *   title         - page <title> text
 *   showFooter    - whether to render site-footer (default true)
 *   showNavLinks  - whether to render nav links (default true)
 *   showNavProfile- whether to render profile dropdown (default true)
 *   bodyBefore    - JSX to render before the page-wrapper (planets, nebula layers)
 *   children      - page content
 */
export default function Layout({
  title,
  showFooter = true,
  showNavLinks = true,
  showNavProfile = true,
  bodyBefore = null,
  children,
}) {
  React.useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  React.useEffect(() => {
    // Wire auth.js to React-rendered DOM elements (profile dropdown, modals, etc.)
    // auth.js runs before React renders so its wire() call finds no elements;
    // this re-wires them once the DOM is ready.
    if (window.Auth?.setupDOM) window.Auth.setupDOM();
  }, []);

  return (
    <>
      {bodyBefore}
      <BoycottNotice />

      <div className="page-wrapper" id="pageWrapper">
        <Navbar showNavLinks={showNavLinks} showNavProfile={showNavProfile} />

        {children}

        {showFooter && <div className="footer-spacer" />}
        {showFooter && <Footer />}
      </div>

      {/* ===== SHARED MODALS ===== */}
      <AccountModal />
      <SignoutModal />
      <ConfirmDeleteModal />
      <ErrorModal />
    </>
  )
}
