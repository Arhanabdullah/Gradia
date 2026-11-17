// RouteMetaUpdater - updates document meta tags on route changes

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { updateDocumentMeta } from "../lib/meta";

export default function RouteMetaUpdater() {
  const location = useLocation();

  useEffect(() => {
    updateDocumentMeta(location.pathname);
  }, [location.pathname]);

  return null;
}