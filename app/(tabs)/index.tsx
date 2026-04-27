import { Picker } from "@react-native-picker/picker";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Image, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

type Mode = "image_only" | "gross_weight" | "net_weight";

type ApiSuccessFood = {
  status: "food";
  carbs_g: number;
  bolus_iu: number;
};

type ApiSuccessNotFood = {
  status: "not_food";
};

type ApiError = {
  detail?: string;
};

type ApiResponse = ApiSuccessFood | ApiSuccessNotFood | ApiError;

type PickedAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

type ImageSource = "gallery" | "camera" | null;

export default function HomeScreen() {
  const [mode, setMode] = useState<Mode>("image_only");
  const [weight, setWeight] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageAsset, setImageAsset] = useState<PickedAsset | null>(null);
  const [imageSource, setImageSource] = useState<ImageSource>(null);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const [ICR, setICR] = useState("10");
  const [result, setResult] = useState("—");
  const [loading, setLoading] = useState(false);

 const API_BASE_URL = "http://192.168.1.28:8000";



  function clearImage() {
    setImageAsset(null);
    setImageUri(null);
    setImageSource(null);
    setResult("—");
    setShowPhotoOptions(false);
  }

  async function pickImage() {
    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 1,
    });

    if (!pickerResult.canceled) {
      const asset = pickerResult.assets[0];
      setImageAsset({
        uri: asset.uri,
        fileName: asset.fileName ?? null,
        mimeType: asset.mimeType ?? null,
      });

     
      setImageUri(asset.uri);
      setImageSource("gallery");
      setResult("—");
    }

    setShowPhotoOptions(false);
  }

  async function takePhoto() {
    if (Platform.OS === "web") {
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      alert("Camera permission is required.");
      return;
    }

    const cameraResult = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 1,
    });

    if (!cameraResult.canceled) {
      const asset = cameraResult.assets[0];
      setImageAsset({
        uri: asset.uri,
        fileName: asset.fileName ?? "photo.jpg",
        mimeType: asset.mimeType ?? "image/jpeg",
      });
      setImageUri(asset.uri);
      setImageSource("camera");
      setResult("—");
    }

    setShowPhotoOptions(false);
  }

  async function estimate() {
    if (!imageAsset) {
      alert("Please add an image first.");
      return;
    }

    if ((mode === "gross_weight" || mode === "net_weight") && !weight.trim()) {
      alert("Please enter a weight in grams or change Mode to Image Only.");
      return;
    }

    try {
      setLoading(true);
      setResult("Estimating...");

      const formData = new FormData();

      if (Platform.OS === "web") {
        const blob = await fetch(imageAsset.uri).then((r) => r.blob());
        formData.append("image", blob, imageAsset.fileName ?? "photo.png");
      } else {
        formData.append(
          "image",
          {
            uri: imageAsset.uri,
            name: imageAsset.fileName ?? "photo.png",
            type: imageAsset.mimeType ?? "image/png",
          } as any
        );
      }

      formData.append("mode", mode);

      if (mode === "gross_weight") {
        formData.append("gross_weight_g", weight);
      }

      if (mode === "net_weight") {
        formData.append("net_weight_g", weight);
      }

      formData.append("icr", ICR === "" ? "10" : ICR);

      const response = await fetch(`${API_BASE_URL}/estimate-image`, {
        method: "POST",
        body: formData,
      });

      const data: ApiResponse = await response.json();

      console.log("status:", response.status);
      console.log("data:", data);

      if (!response.ok) {
        if ("detail" in data && data.detail) {
          setResult(data.detail);
        } else {
          setResult("Bad request");
        }
        return;
      }

      if ("status" in data && data.status === "not_food") {
        setResult("Invalid");
        return;
      }

      if (
        "status" in data &&
        data.status === "food" &&
        typeof data.carbs_g === "number" &&
        typeof data.bolus_iu === "number"
      ) {
        setResult(`${data.carbs_g} g (${data.bolus_iu} IU)`);
        return;
      }

      setResult("Unexpected response");
    } catch (error) {
      console.error("estimate error:", error);
      setResult("Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#f3f6fb" }}>
      <View
        style={{
          width: "100%",
          maxWidth: 760,
          alignSelf: "center",
          paddingHorizontal: 20,
          paddingVertical: 28,
        }}
      >
        <View
          style={{
            backgroundColor: "#ffffff",
            borderRadius: 24,
            padding: 24,
            borderWidth: 1,
            borderColor: "#e6ebf2",
            shadowColor: "#000",
            shadowOpacity: 0.06,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: 3,
          }}
        >
          <Text
            style={{
              fontSize: 30,
              fontWeight: "700",
              color: "#0c3b6e" ,
              marginBottom: 8,

            }}
          >
            AI Bolus Estimator
          </Text>

          <Text
            style={{
              color: "#5e6b7a",
              fontSize: 16,
              lineHeight: 24,
              marginBottom: 28,
            }}
          >
            Input your ICR, select a mode, optionally enter weight, and add an
            image of your meal. Then click Go to estimate carbohydrates and bolus.
          </Text>

          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: "#0c3b6e",
              marginBottom: 10,
            }}

          >
            Insulin-to-carb ratio (ICR)
          </Text>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              marginBottom: 24,
              flexWrap: "wrap",
            }}
          >
            <TextInput
              value={ICR}
              keyboardType="numeric"
              style={{
                borderWidth: 1,
                borderColor: "#d8e0ea",
                backgroundColor: "#f9fbfd",
                borderRadius: 14,
                paddingVertical: 14,
                paddingHorizontal: 16,
                width: 110,
                fontSize: 16,
                color: "#142033",
              }}
              onFocus={() => {
                if (ICR === "10") {
                  setICR("");
                }
              }}
              onBlur={() => {
                if (!ICR || ICR.trim() === "") {
                  setICR("10");
                }
              }}
              onChangeText={(text) => {
                const clean = text.replace(/[^0-9]/g, "");
                setICR(clean);
              }}
            />
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: "#546171",
              }}
            >
              g CHO / IU
            </Text>
          </View>

          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: "#0c3b6e",
              marginBottom: 10,
            }}
          >
            Mode
          </Text>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              marginBottom: 28,
              flexWrap: "wrap",
            }}
          >
            <View
              style={{
                backgroundColor: "#f9fbfd",
                borderWidth: 1,
                borderColor: "#d8e0ea",
                borderRadius: 14,
                overflow: "hidden",
                minWidth: 250,
              }}
            >
              <Picker
                selectedValue={mode}
                onValueChange={(itemValue) => {
                  const nextMode = itemValue as Mode;
                  setMode(nextMode);
                  if (nextMode === "image_only") {
                    setWeight("");
                  }
                }}
                style={{ width: 250, height: 170}}
                itemStyle={{ fontSize: 18, color: "#142033" }}
              >
                <Picker.Item label="Image Only" value="image_only" />
                <Picker.Item label="Gross Weight" value="gross_weight" />
                <Picker.Item label="Net Weight" value="net_weight" />
              </Picker>
            </View>

            <TextInput
              value={weight}
              onChangeText={(text) => {
                const clean = text.replace(/[^0-9]/g, "");
                setWeight(clean);
              }}
              editable={mode !== "image_only"}
              placeholder={mode === "image_only" ? "-" : ""}
              keyboardType="numeric"
              style={{
                borderWidth: 1,
                borderColor: "#d8e0ea",
                backgroundColor: mode === "image_only" ? "#eef2f6" : "#f9fbfd",
                borderRadius: 14,
                paddingVertical: 14,
                paddingHorizontal: 16,
                width: 140,
                fontSize: 16,
                color: mode === "image_only" ? "#98a2af" : "#142033",
              }}
            />

            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: "#546171",
              }}
            >
              g
            </Text>
          </View>

          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: "#0c3b6e",
              marginBottom: 10,
            }}
          >
            Meal image
          </Text>

          <Pressable
            onPress={() => setShowPhotoOptions((prev) => !prev)}
            style={{
              backgroundColor: "#eef4ff",
              borderWidth: 1,
              borderColor: "#cfe0ff",
              paddingVertical: 14,
              paddingHorizontal: 18,
              borderRadius: 14,
              alignSelf: "flex-start",
              marginBottom: 12,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: "#285ea8",
              }}
            >
              {imageUri ? "Change photo" : "Add photo"}
            </Text>
          </Pressable>

          {showPhotoOptions && (
            <View
              style={{
                width: "100%",
                maxWidth: 360,
                backgroundColor: "#f9fbfd",
                borderWidth: 1,
                borderColor: "#d8e0ea",
                borderRadius: 16,
                padding: 12,
                marginBottom: 18,
                gap: 10,
              }}
            >
              <Pressable
                onPress={pickImage}
                style={{
                  backgroundColor: "#ffffff",
                  borderWidth: 1,
                  borderColor: "#d8e0ea",
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: "600", color: "#243247" }}>
                  From gallery
                </Text>
              </Pressable>

              {Platform.OS !== "web" && (
                <Pressable
                  onPress={takePhoto}
                  style={{
                    backgroundColor: "#ffffff",
                    borderWidth: 1,
                    borderColor: "#d8e0ea",
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderRadius: 12,
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: "600", color: "#243247" }}>
                    Take photo
                  </Text>
                </Pressable>
              )}

              {imageUri && (
                <Pressable
                  onPress={clearImage}
                  style={{
                    backgroundColor: "#fff7f7",
                    borderWidth: 1,
                    borderColor: "#ffd6d6",
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderRadius: 12,
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: "600", color: "#b54848" }}>
                    Remove photo
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          <View
            style={{
              width: "100%",
              maxWidth: 360,
              height: 250,
              backgroundColor: "#f4f7fa",
              borderWidth: 1,
              borderColor: "#d8e0ea",
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 10,
              overflow: "hidden",
            }}
          >
            {imageUri ? (
              <Image
                source={{ uri: imageUri }}
                style={{
                  width: "100%",
                  height: "100%",
                }}
                resizeMode="cover"
              />
            ) : (
              <Text style={{ color: "#6f7b88", fontSize: 15 }}>Image preview</Text>
            )}
          </View>

          {imageUri && (
            <Text
              style={{
                color: "#6f7b88",
                fontSize: 14,
                marginBottom: 22,
              }}
            >
              {imageSource === "gallery"
                ? "Selected from gallery"
                : imageSource === "camera"
                ? "Captured with camera"
                : ""}
            </Text>
          )}

          <Pressable
            onPress={estimate}
            disabled={loading}
            style={{
              backgroundColor: loading ? "#9ec7ef" : "#3498DB",
              paddingVertical: 15,
              paddingHorizontal: 26,
              borderRadius: 14,
              alignSelf: "flex-start",
              marginBottom: 28,
              opacity: loading ? 0.9 : 1,
            }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "700", fontSize: 18 }}>
              {loading ? "Estimating..." : "Go"}
            </Text>
          </Pressable>

          <View
            style={{
              borderWidth: 1,
              borderColor: "#bfdbfe",
              borderRadius: 24,
              backgroundColor: "#eff6ff",
              padding: 24,
              minHeight: 150,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.08,
              shadowRadius: 12,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: "#8e9aaf",
                marginBottom: 12,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Estimated Bolus
            </Text>

            {loading ? (
              <View style={{ paddingVertical: 10 }}>
                <Text style={{ fontSize: 24, fontWeight: "600", color: "#3498DB", fontStyle: "italic" }}>
                  Estimating...
                </Text>
              </View>
            ) : result !== "—" && result.includes("(") ? (
              <View>
                <Text style={{ fontSize: 42, fontWeight: "800", color: "#007AFF" }}>
                  {result.split("(")[1].split(" ")[0]}
                  <Text style={{ fontSize: 20, color: "#007AFF" }}> IU</Text>
                </Text>

                <Text style={{ fontSize: 20, color: "#526073", marginTop: 4, fontWeight: "500" }}>
                  Based on {result.split(" ")[0]}g of carbs
                </Text>

                <View
                  style={{
                    marginTop: 20,
                    padding: 12,
                    backgroundColor: "#FFF9F2",
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: "#FFE2C4",
                  }}
                >
                  <Text style={{ fontSize: 11, color: "#855D33", lineHeight: 16, fontWeight: "600" }}>
                    ⚠️ NOT MEDICAL ADVICE
                  </Text>
                  <Text style={{ fontSize: 10, color: "#855D33", lineHeight: 14, marginTop: 2 }}>
                    Do not use for dosing. Always rely on your official medical equipment and professional advice for treatment.
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={{ fontSize: 18, color: "#bdc3c7", fontStyle: "italic" }}>
                {result === "Invalid" ? "Food not detected" : "-"}
              </Text>
            )}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}