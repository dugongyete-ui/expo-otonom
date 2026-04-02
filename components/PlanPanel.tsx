import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { NativeIcon } from "@/components/icons/SvgIcon";

interface Step {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
}

interface Plan {
  steps: Step[];
}

interface PlanPanelProps {
  plan: Plan;
}

export function PlanPanel({ plan }: PlanPanelProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (stepId: string) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId);
    } else {
      newExpanded.add(stepId);
    }
    setExpandedSteps(newExpanded);
  };

  const getStepIcon = (status: string) => {
    switch (status) {
      case "running":
        return "ellipsis-horizontal";
      case "completed":
        return "checkmark-circle";
      case "failed":
        return "close-circle";
      default:
        return "radio-button-off";
    }
  };

  const getStepColor = (status: string) => {
    switch (status) {
      case "running":
        return "#4a7cf0";
      case "completed":
        return "#34C759";
      case "failed":
        return "#dc2626";
      default:
        return "#8a8780";
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <NativeIcon name="list" size={16} color="#636366" />
        <Text style={styles.headerTitle}>Plan</Text>
      </View>

      <ScrollView
        style={styles.stepsList}
        showsVerticalScrollIndicator={false}
        scrollEnabled={false}
      >
        {plan.steps.map((step, index) => (
          <View key={step.id} style={styles.stepContainer}>
            {/* Step Header */}
            <TouchableOpacity
              style={styles.stepHeader}
              onPress={() => toggleStep(step.id)}
              activeOpacity={0.7}
            >
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>

              <View style={styles.stepInfo}>
                <Text style={styles.stepDescription} numberOfLines={2}>
                  {step.description}
                </Text>
                <Text style={styles.stepStatus}>{step.status}</Text>
              </View>

              <NativeIcon
                name={getStepIcon(step.status)}
                size={18}
                color={getStepColor(step.status)}
              />

              <NativeIcon
                name={expandedSteps.has(step.id) ? "chevron-up" : "chevron-down"}
                size={16}
                color="#8a8780"
              />
            </TouchableOpacity>

            {/* Step Details */}
            {expandedSteps.has(step.id) && (
              <View style={styles.stepDetails}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <Text style={styles.detailValue}>{step.status}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Description</Text>
                  <Text style={styles.detailValue}>{step.description}</Text>
                </View>
              </View>
            )}

            {/* Step Divider */}
            {index < plan.steps.length - 1 && (
              <View style={styles.stepDivider} />
            )}
          </View>
        ))}
      </ScrollView>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${
                  (plan.steps.filter((s) => s.status === "completed").length /
                    plan.steps.length) *
                  100
                }%`,
              },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {plan.steps.filter((s) => s.status === "completed").length} of{" "}
          {plan.steps.length} steps completed
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#242424",
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  headerTitle: {
    color: "#f3f4f6",
    fontSize: 14,
    fontWeight: "600",
  },
  stepsList: {
    maxHeight: 200,
    marginBottom: 12,
  },
  stepContainer: {
    marginBottom: 8,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#1a1916",
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  stepInfo: {
    flex: 1,
    gap: 2,
  },
  stepDescription: {
    color: "#f3f4f6",
    fontSize: 12,
    fontWeight: "500",
  },
  stepStatus: {
    color: "#a0a0a0",
    fontSize: 11,
  },
  stepDetails: {
    backgroundColor: "#2a2a2a",
    borderRadius: 6,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  detailItem: {
    gap: 4,
  },
  detailLabel: {
    color: "#a0a0a0",
    fontSize: 11,
    fontWeight: "500",
  },
  detailValue: {
    color: "#f3f4f6",
    fontSize: 12,
  },
  stepDivider: {
    height: 1,
    backgroundColor: "#3a3a3a",
    marginVertical: 8,
  },
  progressContainer: {
    gap: 6,
  },
  progressBar: {
    height: 4,
    backgroundColor: "#3a3a3a",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#4a7cf0",
  },
  progressText: {
    color: "#a0a0a0",
    fontSize: 11,
  },
});
