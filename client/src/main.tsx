import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, Link } from "react-router-dom";
import "./index.css";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Contracts from "./pages/Contracts";
import Upload from "./pages/Upload";
import ContractDetail from "./pages/ContractDetail";
import Upcoming from "./pages/Upcoming";
import About from "./pages/About";
import ErrorBoundary from "./components/ErrorBoundary";

function NotFound() {
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <div className="text-lg font-semibold">Page not found</div>
      <Link to="/" className="mt-3 inline-block text-brand-600 hover:underline">Back to the dashboard</Link>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="contracts" element={<Contracts />} />
            <Route path="contracts/:id" element={<ContractDetail />} />
            <Route path="contracts/:id/upload" element={<Upload />} />
            <Route path="upload" element={<Upload />} />
            <Route path="upcoming" element={<Upcoming />} />
            <Route path="about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
