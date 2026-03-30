import { useState, useEffect } from "react";
import { Button, Spinner } from "@patternfly/react-core";

interface ProviderInfo {
  provider: string;
  defaultModel: string;
  models: string[];
}

interface IssueConfig {
  provider: string;
  model: string;
}

interface BatchConfigModalProps {
  defaultProvider: string;
  defaultModel: string;
  providers: ProviderInfo[];
  onConfirm: (
    defaultConfig: { provider: string; model: string },
    overrides: Record<string, { provider: string; model: string }>,
  ) => void;
  onCancel: () => void;
  discoverIssues: () => Promise<string[]>;
}

export function BatchConfigModal({
  defaultProvider,
  defaultModel,
  providers,
  onConfirm,
  onCancel,
  discoverIssues,
}: BatchConfigModalProps) {
  const [issueKeys, setIssueKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batchProvider, setBatchProvider] = useState(defaultProvider);
  const [batchModel, setBatchModel] = useState(defaultModel);
  const [perIssue, setPerIssue] = useState<Record<string, IssueConfig>>({});

  useEffect(() => {
    discoverIssues()
      .then((keys) => {
        setIssueKeys(keys);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to discover issues");
        setLoading(false);
      });
  }, [discoverIssues]);

  const handleBatchProviderChange = (provider: string) => {
    setBatchProvider(provider);
    const match = providers.find((p) => p.provider === provider);
    if (match) setBatchModel(match.defaultModel);
  };

  const getIssueConfig = (key: string): IssueConfig => {
    return perIssue[key] ?? { provider: batchProvider, model: batchModel };
  };

  const setIssueProvider = (key: string, provider: string) => {
    const match = providers.find((p) => p.provider === provider);
    setPerIssue((prev) => ({
      ...prev,
      [key]: { provider, model: match?.defaultModel ?? "" },
    }));
  };

  const setIssueModel = (key: string, model: string) => {
    setPerIssue((prev) => ({
      ...prev,
      [key]: { ...getIssueConfig(key), model },
    }));
  };

  const resetIssue = (key: string) => {
    setPerIssue((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const isCustom = (key: string) => key in perIssue;

  const handleConfirm = () => {
    const overrides: Record<string, { provider: string; model: string }> = {};
    for (const [key, config] of Object.entries(perIssue)) {
      if (config.provider !== batchProvider || config.model !== batchModel) {
        overrides[key] = config;
      }
    }
    onConfirm({ provider: batchProvider, model: batchModel }, overrides);
  };

  const modelsForProvider = (provider: string) =>
    providers.find((p) => p.provider === provider)?.models ?? [];

  return (
    <div className="us-modal-overlay" onClick={onCancel}>
      <div
        className="us-modal us-batch-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="us-modal__header">
          <h3 className="us-modal__title">Configure Batch Run</h3>
          <button className="us-modal__close" onClick={onCancel}>
            &times;
          </button>
        </div>

        {loading ? (
          <div className="us-batch-modal__loading">
            <Spinner size="lg" />
            <span>Discovering issues...</span>
          </div>
        ) : error ? (
          <div className="us-batch-modal__error">
            <p>{error}</p>
            <Button variant="secondary" onClick={onCancel}>
              Close
            </Button>
          </div>
        ) : issueKeys.length === 0 ? (
          <div className="us-batch-modal__empty">
            <p>No candidate issues found.</p>
            <Button variant="secondary" onClick={onCancel}>
              Close
            </Button>
          </div>
        ) : (
          <>
            {/* Batch default controls */}
            <div className="us-batch-modal__defaults">
              <span className="us-batch-modal__defaults-label">
                Default for all ({issueKeys.length} issue{issueKeys.length !== 1 ? "s" : ""})
              </span>
              <select
                className="us-select"
                value={batchProvider}
                onChange={(e) => handleBatchProviderChange(e.target.value)}
                aria-label="Default provider"
              >
                {providers.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.provider}
                  </option>
                ))}
              </select>
              <select
                className="us-select"
                value={batchModel}
                onChange={(e) => setBatchModel(e.target.value)}
                aria-label="Default model"
              >
                {modelsForProvider(batchProvider).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* Per-issue table */}
            <div className="us-batch-modal__table-wrap">
              <table className="us-batch-modal__table">
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Provider</th>
                    <th>Model</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {issueKeys.map((key) => {
                    const config = getIssueConfig(key);
                    const custom = isCustom(key);
                    return (
                      <tr
                        key={key}
                        className={custom ? "us-batch-modal__row--custom" : ""}
                      >
                        <td className="us-batch-modal__issue">{key}</td>
                        <td>
                          <select
                            className="us-select us-select--full"
                            value={config.provider}
                            onChange={(e) => setIssueProvider(key, e.target.value)}
                            aria-label={`Provider for ${key}`}
                          >
                            {providers.map((p) => (
                              <option key={p.provider} value={p.provider}>
                                {p.provider}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className="us-select us-select--full"
                            value={config.model}
                            onChange={(e) => setIssueModel(key, e.target.value)}
                            aria-label={`Model for ${key}`}
                          >
                            {modelsForProvider(config.provider).map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {custom && (
                            <button
                              className="us-batch-modal__reset"
                              onClick={() => resetIssue(key)}
                              title="Reset to default"
                            >
                              &times;
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div className="us-modal__actions">
              <Button variant="link" onClick={onCancel}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleConfirm}>
                Start {issueKeys.length} run{issueKeys.length !== 1 ? "s" : ""}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
