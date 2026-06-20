'use client';

import { Check } from 'lucide-react';

export type CalculateStep = {
  id: number;
  label: string;
  description?: string;
};

type CalculateStepperProps = {
  steps: CalculateStep[];
  currentStep: number;
  onStepChange: (step: number) => void;
  maxReachableStep?: number;
};

export function CalculateStepper({
  steps,
  currentStep,
  onStepChange,
  maxReachableStep = steps.length,
}: CalculateStepperProps) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 mb-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {steps.map((step, idx) => {
          const done = currentStep > step.id;
          const active = currentStep === step.id;
          const reachable = step.id <= maxReachableStep;
          return (
            <div key={step.id} className="flex items-center gap-3 flex-1 min-w-0">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => reachable && onStepChange(step.id)}
                className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  active
                    ? 'bg-[#F97316] text-white ring-4 ring-orange-100'
                    : done
                      ? 'bg-green-500 text-white'
                      : reachable
                        ? 'bg-gray-100 text-text-secondary hover:bg-orange-50'
                        : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                }`}
              >
                {done ? <Check className="w-4 h-4" /> : step.id}
              </button>
              <div className="min-w-0">
                <p className={`text-sm font-semibold truncate ${active ? 'text-orange-primary' : 'text-text-primary'}`}>
                  {step.label}
                </p>
                {step.description ? (
                  <p className="text-xs text-text-muted truncate hidden sm:block">{step.description}</p>
                ) : null}
              </div>
              {idx < steps.length - 1 ? (
                <div className="hidden lg:block flex-1 h-px bg-border-default mx-2 min-w-[12px]" aria-hidden />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-4 pt-4 border-t border-border-default">
        <button
          type="button"
          disabled={currentStep <= 1}
          onClick={() => onStepChange(currentStep - 1)}
          className="text-sm font-semibold text-text-secondary disabled:opacity-40 hover:text-orange-primary"
        >
          ← Previous
        </button>
        <button
          type="button"
          disabled={currentStep >= steps.length}
          onClick={() => onStepChange(Math.min(currentStep + 1, maxReachableStep))}
          className="text-sm font-semibold text-orange-primary disabled:opacity-40 hover:underline"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
