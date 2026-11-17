import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Loader2, CheckCircle } from "lucide-react";
import { microTransition } from "../animations/variants";

const RequestDemoModal = ({ isOpen, onClose }) => {
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
    if (!validateForm()) return;

    setIsSubmitting(true);
    await new Promise((r) => setTimeout(r, 1200));
    setIsSubmitting(false);
    setStep("success");
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={microTransition}
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <motion.div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={microTransition}
        />
        <motion.div
          className="glass-panel relative w-full max-w-md rounded-2xl overflow-hidden"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-(--border)">
            <h2 id="modal-title" className="font-ui text-lg font-semibold text-(--foreground)">
              Request a demo
            </h2>
            <motion.button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-(--muted-foreground) hover:text-(--foreground) hover:bg-(--surface-secondary) transition-colors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.92 }}
              transition={microTransition}
              aria-label="Close modal"
            >
              <X size={18} strokeWidth={2} />
            </motion.button>
          </div>

          <AnimatePresence mode="wait">
            {step === "form" && (
              <motion.form
                key="form"
                onSubmit={handleSubmit}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={microTransition}
                className="p-6 space-y-5"
              >
                <p className="text-sm text-(--muted-foreground)">
                  Tell us a bit about your institution and we'll reach out to schedule a walkthrough.
                </p>

                <div className="space-y-2">
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
                    className={`w-full rounded-lg border px-4 py-2.5 text-sm text-(--foreground) placeholder-(--muted-foreground) bg-(--surface) transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--primary) ${
                      errors.name
                        ? "border-(--danger) focus-visible:ring-(--danger)"
                        : "border-(--border) hover:border-(--muted)"
                    }`}
                    aria-invalid={errors.name ? "true" : "false"}
                    aria-describedby={errors.name ? "name-error" : undefined}
                    disabled={isSubmitting}
                  />
                  {errors.name && (
                    <p id="name-error" className="text-xs text-(--danger)" role="alert">
                      {errors.name}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
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
                    className={`w-full rounded-lg border px-4 py-2.5 text-sm text-(--foreground) placeholder-(--muted-foreground) bg-(--surface) transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--primary) ${
                      errors.email
                        ? "border-(--danger) focus-visible:ring-(--danger)"
                        : "border-(--border) hover:border-(--muted)"
                    }`}
                    aria-invalid={errors.email ? "true" : "false"}
                    aria-describedby={errors.email ? "email-error" : undefined}
                    disabled={isSubmitting}
                  />
                  {errors.email && (
                    <p id="email-error" className="text-xs text-(--danger)" role="alert">
                      {errors.email}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
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
                    className={`w-full rounded-lg border px-4 py-2.5 text-sm text-(--foreground) placeholder-(--muted-foreground) bg-(--surface) transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--primary) ${
                      errors.institution
                        ? "border-(--danger) focus-visible:ring-(--danger)"
                        : "border-(--border) hover:border-(--muted)"
                    }`}
                    aria-invalid={errors.institution ? "true" : "false"}
                    aria-describedby={errors.institution ? "institution-error" : undefined}
                    disabled={isSubmitting}
                  />
                  {errors.institution && (
                    <p id="institution-error" className="text-xs text-(--danger)" role="alert">
                      {errors.institution}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="role" className="block text-sm font-medium text-(--foreground)">
                    Your role
                  </label>
                  <select
                    id="role"
                    name="role"
                    value={formData.role}
                    onChange={handleChange}
                    className={`w-full rounded-lg border px-4 py-2.5 text-sm text-(--foreground) bg-(--surface) transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--primary) appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238d939c' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")] bg-no-repeat bg-[right_12px_center] pr-10 ${
                      errors.role
                        ? "border-(--danger) focus-visible:ring-(--danger)"
                        : "border-(--border) hover:border-(--muted)"
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
                    <p id="role-error" className="text-xs text-(--danger)" role="alert">
                      {errors.role}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
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
                    className="w-full rounded-lg border px-4 py-2.5 text-sm text-(--foreground) placeholder-(--muted-foreground) bg-(--surface) transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--primary) border-(--border) hover:border-(--muted) resize-y"
                    disabled={isSubmitting}
                  />
                </div>

                <motion.button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-lg bg-(--primary) px-5 py-3 text-sm font-semibold text-(--background) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  transition={microTransition}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      Send request
                      <Send className="ml-2 h-4 w-4" strokeWidth={2} />
                    </>
                  )}
                </motion.button>

                <p className="text-xs text-center text-(--muted-foreground)">
                  By submitting, you agree to be contacted about Gradia. We respect your privacy.
                </p>
              </motion.form>
            )}

            {step === "success" && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="px-6 py-10 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 15 }}
                  className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-(--success-subtle)"
                >
                  <CheckCircle className="h-8 w-8 text-(--success)" strokeWidth={2.5} />
                </motion.div>
                <h3 className="font-ui text-xl font-semibold text-(--foreground)">
                  Request sent
                </h3>
                <p className="mt-2 text-sm text-(--muted-foreground)">
                  Thanks for your interest! We'll reach out to{" "}
                  <strong>{formData.email}</strong> within one business day.
                </p>
                <motion.button
                  onClick={() => {
                    setStep("form");
                    setFormData({
                      name: "",
                      email: "",
                      institution: "",
                      role: "",
                      message: "",
                    });
                    onClose();
                  }}
                  className="mt-6 rounded-lg bg-(--primary) px-5 py-2.5 text-sm font-semibold text-(--background) transition-colors hover:bg-(--primary-hover)"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={microTransition}
                >
                  Close
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default RequestDemoModal;