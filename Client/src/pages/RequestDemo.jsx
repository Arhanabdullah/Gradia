import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Loader2, CheckCircle, ArrowLeft, Shield, Users, GraduationCap, Building2, AlertCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { microTransition } from "../animations/variants";
import Navbar from "../components/Navbar/Navbar";
import { setTheme, getTheme } from "../lib/theme";
import Footer from "../components/Footer";
import { supabase } from "../lib/supabase";

const DEMO_REQUEST_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/demo-request`;

const RequestDemoPage = () => {
  const navigate = useNavigate();
  const [theme, setThemeState] = useState(() => getTheme());
  const [step, setStep] = useState("form");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    institution: "",
    role: "",
    message: "",
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useDocumentTitle("Request a demo · Gradia");

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e) => setReducedMotion(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  const handleThemeChange = (next) => {
    setThemeState(next);
    setTheme(next);
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Name is required";
    if (!formData.email.trim()) newErrors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email";
    }
    if (!formData.institution.trim()) newErrors.institution = "Institution is required";
    if (!formData.role) newErrors.role = "Please select your role";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(DEMO_REQUEST_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          email: formData.email.trim().toLowerCase(),
          institution: formData.institution.trim(),
          role: formData.role,
          message: formData.message.trim(),
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to submit request");
      }

      setStep("success");
    } catch (err) {
      setSubmitError(err.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const handleBack = () => {
    if (step === "success") {
      setStep("form");
      setFormData({
        name: "",
        email: "",
        institution: "",
        role: "",
        message: "",
      });
    } else {
      navigate(-1);
    }
  };

  const roles = [
    { icon: GraduationCap, label: "Principals & Deans", desc: "Full oversight of results publication" },
    { icon: Users, label: "Heads of Department", desc: "Review and approve result sheets" },
    { icon: Building2, label: "Administrators", desc: "Manage exams, classes, and users" },
    { icon: Shield, label: "Teachers & Faculty", desc: "Enter marks and track student progress" },
  ];

  return (
    <div className="relative min-h-screen bg-(--background) text-(--foreground)">
      <Navbar theme={theme} setTheme={handleThemeChange} />

      <main id="main-content" tabIndex={-1} className="focus-target flex-1 pt-20">
        <div className="mx-auto max-w-7xl px-6 py-14 md:py-20">
          <div className="grid gap-12 lg:grid-cols-12">
            {/* Form — the hero */}
            <div className="lg:col-span-7">
              <motion.button
                onClick={handleBack}
                className="flex items-center gap-2 h-11 px-4 text-sm font-medium text-(--foreground) hover:bg-(--surface-secondary) transition-colors mb-8 rounded-lg bg-(--surface) border border-(--border) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
                whileHover={{ x: -4 }}
                whileTap={{ scale: 0.98 }}
                transition={microTransition}
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2} />
                Back
              </motion.button>

              <AnimatePresence mode="wait">
                {step === "form" && (
                  <motion.div
                    key="form"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <div className="mb-6">
                      <h1 className="font-editorial text-3xl font-medium text-(--foreground) sm:text-4xl leading-tight">
                        Request a demo
                      </h1>
                      <p className="mt-2 text-sm text-(--foreground) max-w-xl opacity-70">
                        Tell us about your institution and we&rsquo;ll reach out to schedule a personalized walkthrough.
                      </p>
                    </div>

                    <div className="rounded-2xl p-6 md:p-8 bg-(--surface) border border-(--muted)">
                      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                        <div className="space-y-1.5">
                          <label htmlFor="name" className="block text-sm font-medium text-(--foreground)">
                            Full name
                          </label>
                          <input
                            id="name"
                            name="name"
                            type="text"
                            autoComplete="name"
                            value={formData.name}
                            onChange={handleChange}
                            className={`w-full h-11 rounded-lg border-2 px-4 text-base text-(--foreground) placeholder-(--muted-foreground) bg-(--background) transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--primary) ${
                              errors.name
                                ? "border-(--danger) focus-visible:ring-(--danger)"
                                : "border-(--muted) hover:border-(--primary)"
                            }`}
                            aria-invalid={errors.name ? "true" : "false"}
                            aria-describedby={errors.name ? "name-error" : undefined}
                            disabled={isSubmitting}
                          />
                          {errors.name && (
                            <p id="name-error" className="text-sm text-(--danger)" role="alert">
                              {errors.name}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="email" className="block text-sm font-medium text-(--foreground)">
                            Work email
                          </label>
                          <input
                            id="email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            value={formData.email}
                            onChange={handleChange}
                            className={`w-full h-11 rounded-lg border-2 px-4 text-base text-(--foreground) placeholder-(--muted-foreground) bg-(--background) transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--primary) ${
                              errors.email
                                ? "border-(--danger) focus-visible:ring-(--danger)"
                                : "border-(--muted) hover:border-(--primary)"
                            }`}
                            aria-invalid={errors.email ? "true" : "false"}
                            aria-describedby={errors.email ? "email-error" : undefined}
                            disabled={isSubmitting}
                          />
                          {errors.email && (
                            <p id="email-error" className="text-sm text-(--danger)" role="alert">
                              {errors.email}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="institution" className="block text-sm font-medium text-(--foreground)">
                            Institution
                          </label>
                          <input
                            id="institution"
                            name="institution"
                            type="text"
                            autoComplete="organization"
                            value={formData.institution}
                            onChange={handleChange}
                            placeholder="e.g., Greenfield University"
                            className={`w-full h-11 rounded-lg border-2 px-4 text-base text-(--foreground) placeholder-(--muted-foreground) bg-(--background) transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--primary) ${
                              errors.institution
                                ? "border-(--danger) focus-visible:ring-(--danger)"
                                : "border-(--muted) hover:border-(--primary)"
                            }`}
                            aria-invalid={errors.institution ? "true" : "false"}
                            aria-describedby={errors.institution ? "institution-error" : undefined}
                            disabled={isSubmitting}
                          />
                          {errors.institution && (
                            <p id="institution-error" className="text-sm text-(--danger)" role="alert">
                              {errors.institution}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="role" className="block text-sm font-medium text-(--foreground)">
                            Your role
                          </label>
                          <select
                            id="role"
                            name="role"
                            value={formData.role}
                            onChange={handleChange}
                            className={`w-full h-11 rounded-lg border-2 px-4 text-base text-(--foreground) bg-(--background) transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--primary) appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238d939c' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")] bg-no-repeat bg-[right_12px_center] pr-10 ${
                              errors.role
                                ? "border-(--danger) focus-visible:ring-(--danger)"
                                : "border-(--muted) hover:border-(--primary)"
                            }`}
                            aria-invalid={errors.role ? "true" : "false"}
                            aria-describedby={errors.role ? "role-error" : undefined}
                            disabled={isSubmitting}
                          >
                            <option value="">Select your role</option>
                            <option value="principal">Principal / Dean</option>
                            <option value="hod">Head of Department</option>
                            <option value="teacher">Teacher / Faculty</option>
                            <option value="admin">Administrator</option>
                            <option value="other">Other</option>
                          </select>
                          {errors.role && (
                            <p id="role-error" className="text-sm text-(--danger)" role="alert">
                              {errors.role}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="message" className="block text-sm font-medium text-(--foreground)">
                            Message (optional)
                          </label>
                          <textarea
                            id="message"
                            name="message"
                            rows={3}
                            value={formData.message}
                            onChange={handleChange}
                            placeholder="Any specific requirements, timelines, or questions?"
                            className="w-full h-24 rounded-lg border-2 px-4 py-3 text-base text-(--foreground) placeholder-(--muted-foreground) bg-(--background) transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--primary) border-(--muted) hover:border-(--primary) resize-y"
                            disabled={isSubmitting}
                          />
                        </div>

                        {submitError && (
                          <div className="flex items-center gap-2 p-3 rounded-lg bg-(--danger-subtle) text-(--danger) text-sm" role="alert">
                            <AlertCircle className="h-4 w-4 flex-shrink-0" strokeWidth={2} />
                            {submitError}
                          </div>
                        )}

                        <motion.button
                          type="submit"
                          disabled={isSubmitting}
                          className="w-full h-12 rounded-lg bg-(--primary) px-6 text-base font-semibold text-(--background) transition-colors hover:bg-(--primary-hover) disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-(--primary) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.98 }}
                          transition={microTransition}
                        >
                          {isSubmitting ? (
                            <span className="flex items-center gap-2">
                              <motion.span
                                animate={reducedMotion ? {} : { rotate: 360 }}
                                transition={{ duration: 1, ease: "linear", repeat: Infinity }}
                                className="h-5 w-5"
                              >
                                <Loader2 strokeWidth={2} />
                              </motion.span>
                              Sending&hellip;
                            </span>
                          ) : (
                            <span className="flex items-center gap-2">
                              Send request
                              <Send className="h-5 w-5" strokeWidth={2} />
                            </span>
                          )}
                        </motion.button>

                        <p className="text-sm text-center text-(--foreground) opacity-60">
                          By submitting, you agree to be contacted about Gradia. We respect your privacy.
                        </p>
                      </form>
                    </div>
                  </motion.div>
                )}

                {step === "success" && (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="text-center py-12"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 15 }}
                      className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-(--success-subtle)"
                    >
                      <CheckCircle className="h-10 w-10 text-(--success)" strokeWidth={2.5} />
                    </motion.div>
                    <h2 className="font-editorial text-3xl font-semibold text-(--foreground)">
                      Request sent
                    </h2>
                    <p className="mt-3 text-lg text-(--foreground) opacity-70">
                      Thanks for your interest! We&rsquo;ll reach out to{" "}
                      <strong>{formData.email}</strong> within one business day.
                    </p>
                    <motion.button
                      onClick={handleBack}
                      className="mt-8 h-12 rounded-lg bg-(--primary) px-6 text-base font-semibold text-(--background) transition-colors hover:bg-(--primary-hover) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={microTransition}
                    >
                      Done
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Trust strip — roles the platform serves */}
            <div className="lg:col-span-5 lg:pl-8">
              <div className="glass-panel rounded-2xl p-6 h-full">
                <h3 className="font-editorial text-xl font-medium text-(--foreground) mb-6">
                  Built for every role
                </h3>
                <div className="space-y-4">
                  {roles.map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="flex items-start gap-4">
                      <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-lg bg-(--primary)/10 text-(--primary)">
                        <Icon className="h-5 w-5" strokeWidth={2} />
                      </div>
                      <div>
                        <p className="font-medium text-(--foreground)">{label}</p>
                        <p className="text-sm text-(--foreground) opacity-70 mt-0.5">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default RequestDemoPage;